import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Phase 3M.8C — the ONLY file in this codebase that knows Cloudflare R2 is
// S3-compatible or imports an AWS SDK package. Every route/lib file talks to
// this small boundary (createUploadUrl/createDownloadUrl/headObject), never
// to S3Client directly — so a future move to another S3-compatible provider
// only ever touches this file, never Community message logic. This is
// deliberately NOT a generic "storage framework": there is exactly one
// provider, one bucket, one purpose (Community message attachments), and no
// abstraction beyond what that requires.
//
// Object bytes are never stored in Neon/PostgreSQL and never touch Render's
// local disk — the application server only ever issues short-lived signed
// URLs; the browser talks to R2 directly for both upload and download.

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Object storage is not configured.');
    this.name = 'StorageNotConfiguredError';
  }
}

interface R2Config {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Read lazily on every call, never cached at module load — so a process
// that starts before credentials are provisioned doesn't need restarting
// once they are (matches this app's existing "read process.env directly"
// convention in lib/env.ts), and so tests can freely set/unset these
// without any module-level state to reset.
function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucketName = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucketName, accessKeyId, secretAccessKey };
}

export function isStorageConfigured(): boolean {
  return readConfig() !== null;
}

function requireClient(): { client: S3Client; bucketName: string } {
  const config = readConfig();
  if (!config) throw new StorageNotConfiguredError();
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return { client, bucketName: config.bucketName };
}

// Signs the PUT with the exact Content-Type the caller declared and
// validated (see attachmentPolicy.ts) — R2, like S3, requires the actual
// upload request's Content-Type header to match what was signed, so this is
// what structurally enforces the declared MIME type on the upload itself,
// without the application server ever downloading or sniffing the bytes.
export async function createUploadUrl(params: { storageKey: string; mimeType: string }): Promise<{ url: string; expiresAt: Date }> {
  const { client, bucketName } = requireClient();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: params.storageKey,
    ContentType: params.mimeType,
  });
  const url = await getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return { url, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000) };
}

// Light on data: download links are signed for a fixed 3-hour window
// (valid for 4 hours), so the SAME link comes back for the same file within
// that window and the phone reuses the photo it already downloaded instead
// of fetching it again. Storage is told to let the phone keep it for a day.
// Still never persisted or logged, and still only handed out after the
// usual permission checks on every request.
const DOWNLOAD_WINDOW_MS = 3 * 60 * 60 * 1000;
const DOWNLOAD_URL_VALID_SECONDS = 4 * 60 * 60;

export function downloadSigningWindowStart(now = Date.now()): Date {
  return new Date(Math.floor(now / DOWNLOAD_WINDOW_MS) * DOWNLOAD_WINDOW_MS);
}

export async function createDownloadUrl(params: { storageKey: string }): Promise<{ url: string; expiresAt: Date }> {
  const { client, bucketName } = requireClient();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: params.storageKey,
    ResponseCacheControl: 'private, max-age=86400',
  });
  const signingDate = downloadSigningWindowStart();
  const url = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_VALID_SECONDS, signingDate });
  return { url, expiresAt: new Date(signingDate.getTime() + DOWNLOAD_URL_VALID_SECONDS * 1000) };
}

// Confirms the browser's direct upload actually landed in R2 before a
// MessageAttachment row is ever created — this is what stops an unfinalized
// or never-actually-uploaded object from becoming a visible attachment (see
// the message-creation route). Returns null if the object doesn't exist.
export async function headObject(params: { storageKey: string }): Promise<{ contentLength: number; contentType: string | undefined } | null> {
  const { client, bucketName } = requireClient();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: params.storageKey }));
    return { contentLength: result.ContentLength ?? 0, contentType: result.ContentType };
  } catch (err: any) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// Exam World books are read inside the app only: the server streams the
// PDF to the signed-in reader itself (same origin, no shareable storage
// link ever reaches the browser). Returns null if the object doesn't exist.
export async function getObjectStream(params: { storageKey: string }): Promise<{ body: NodeJS.ReadableStream; contentLength: number | undefined } | null> {
  const { client, bucketName } = requireClient();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: params.storageKey }));
    if (!result.Body) return null;
    return { body: result.Body as NodeJS.ReadableStream, contentLength: result.ContentLength };
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// Forwarding a photo / voice note: storage copies the file to the new
// chat's own key, server side (nothing passes through the phone or the app
// server), so each message keeps its own file and permissions.
export async function copyObject(params: { sourceKey: string; destKey: string }): Promise<void> {
  const { client, bucketName } = requireClient();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      Key: params.destKey,
      CopySource: `${bucketName}/${params.sourceKey.split('/').map(encodeURIComponent).join('/')}`,
    }),
  );
}
