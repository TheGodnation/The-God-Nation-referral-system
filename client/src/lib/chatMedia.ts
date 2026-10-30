import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { isAllowedAttachmentMime, maxBytesForMime } from './attachmentLimits';

// Helpers for the WhatsApp-style group chat: uploading photos, voice notes
// and videos straight to storage, shrinking big photos first (so they send
// quickly on mobile data), and fetching short-lived links to show media.

export interface UploadedAttachment {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  /** Tiny blurred preview of a photo (a few KB) for slow networks — for a
   * PDF, the top of its first page (see pdfPreview.ts). */
  thumb?: string;
  /** A PDF's number of pages. */
  pageCount?: number;
  /** Which language this voice clip is in (the central admin's two-language voice message only). */
  language?: 'en' | 'fr';
}

export type UploadProblem = 'type' | 'size' | 'storage' | 'failed';

export class ChatUploadError extends Error {
  reason: UploadProblem;
  constructor(reason: UploadProblem) {
    super(reason);
    this.reason = reason;
  }
}

/** "audio/webm;codecs=opus" -> "audio/webm" */
export function baseMime(type: string): string {
  return (type.split(';')[0] || '').trim().toLowerCase();
}

export function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? 'bin';
}

/** Thrown when someone cancels an upload (the ✕ on a photo being sent). */
export class UploadCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

// Sends the file with XMLHttpRequest, the one browser tool that reports how
// much has gone up so far (fetch can't), for the progress circle.
function putWithProgress(url: string, body: Blob, mimeType: string, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<boolean>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => reject(new UploadCancelled());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** authorizePath: the chat's "ask for an upload link" address (group or private chat).
 * With `onProgress`, reports 0–1 as the file goes up; `signal` cancels it. */
export async function uploadChatFile(
  authorizePath: string,
  file: Blob,
  filename: string,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedAttachment> {
  const mimeType = baseMime(file.type);
  if (!isAllowedAttachmentMime(mimeType)) throw new ChatUploadError('type');
  if (file.size > (maxBytesForMime(mimeType) ?? 0)) throw new ChatUploadError('size');
  // Storage checks the exact type it signed, so send the plain type.
  const body = file.type === mimeType ? file : new Blob([file], { type: mimeType });

  let auth: { storageKey: string; uploadUrl: string };
  try {
    auth = await api.post<{ storageKey: string; uploadUrl: string }>(authorizePath, {
      originalFilename: filename,
      mimeType,
      byteSize: body.size,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) throw new ChatUploadError('storage');
    if (err instanceof ApiError && /too large/i.test(err.message)) throw new ChatUploadError('size');
    if (err instanceof ApiError && /type/i.test(err.message)) throw new ChatUploadError('type');
    throw new ChatUploadError('failed');
  }

  if (opts.signal?.aborted) throw new UploadCancelled();
  if (opts.onProgress && typeof XMLHttpRequest !== 'undefined') {
    const ok = await putWithProgress(auth.uploadUrl, body, mimeType, opts.onProgress, opts.signal);
    if (!ok) throw new ChatUploadError('failed');
  } else {
    const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body, signal: opts.signal }).catch(() => {
      if (opts.signal?.aborted) throw new UploadCancelled();
      return null;
    });
    if (!put || !put.ok) throw new ChatUploadError('failed');
  }
  return { storageKey: auth.storageKey, originalFilename: filename, mimeType, byteSize: body.size };
}

// Light for slow networks: photos are sent at most 1280px wide (usually
// 150–300 KB), profile pictures at 512px.
const MAX_PHOTO_SIDE = 1280;
const SHRINK_ABOVE_BYTES = 400 * 1024;

/** Makes phone photos smaller (max 1280px, JPEG) — or `maxSide` if given.
 * Also turns photo types we can't send (like HEIC) into JPEG when the
 * browser can read them. Returns the original file when nothing needs
 * doing or shrinking fails. */
export async function shrinkPhoto(file: File, maxSide = MAX_PHOTO_SIDE): Promise<Blob> {
  const type = baseMime(file.type);
  const allowed = isAllowedAttachmentMime(type);
  if (allowed && file.size <= SHRINK_ABOVE_BYTES && maxSide >= MAX_PHOTO_SIDE) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap: ImageBitmap | null = null;
  const canvas = document.createElement('canvas');
  try {
    // Phones ran out of memory here ("low memory"): a camera photo opened at
    // full size takes 50–400 MB. So the photo is opened straight at the small
    // size when the browser can, and everything is let go of right after.
    const size = await imageSize(file);
    if (size && allowed && file.size <= SHRINK_ABOVE_BYTES && Math.max(size.width, size.height) <= maxSide) return file;
    bitmap = size ? await openSmall(file, size, maxSide) : null;
    if (!bitmap) bitmap = await createImageBitmap(file);
    if (allowed && file.size <= SHRINK_ABOVE_BYTES && Math.max(bitmap.width, bitmap.height) <= maxSide) return file;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    bitmap = null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!blob) return file;
    return allowed && blob.size >= file.size ? file : blob;
  } catch {
    return file;
  } finally {
    bitmap?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** A photo's width and height (as shown, after turning), read without
 * opening the whole picture. */
function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      img.src = '';
      resolve(size);
    };
    img.onload = () => done(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Opens the photo directly at (about) its final size, which takes a small
 * part of the memory. Null when the browser can't, or when the photo came
 * out the wrong way round (then it is opened normally). */
async function openSmall(file: Blob, size: { width: number; height: number }, maxSide: number): Promise<ImageBitmap | null> {
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  if (scale >= 1) return null;
  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: Math.max(1, Math.round(size.width * scale)),
      resizeHeight: Math.max(1, Math.round(size.height * scale)),
      resizeQuality: 'high',
    });
    const sameShape = Math.abs(bitmap.width / bitmap.height - size.width / size.height) < 0.02;
    if (sameShape) return bitmap;
    bitmap.close();
    return null;
  } catch {
    return null;
  }
}

/** A tiny (48px) blurred-looking JPEG of a photo as a data URL — a few KB —
 * shown straight away in chats before the real photo downloads. */
export async function makeThumb(file: Blob): Promise<string | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = 48 / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL('image/jpeg', 0.5);
    return url.startsWith('data:image/jpeg;base64,') && url.length < 8000 ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Best recording format this phone/browser supports. MP4 first because it
 * plays on both Android and iPhone. */
export function pickRecorderMime(kind: 'audio' | 'video'): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  const options =
    kind === 'audio'
      ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find((t) => MediaRecorder.isTypeSupported(t) && isAllowedAttachmentMime(baseMime(t)));
}

export function canRecord(kind: 'audio' | 'video'): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(pickRecorderMime(kind));
}

// Short-lived download links, kept for 4 minutes so scrolling back and
// forth doesn't ask the server again and again.
const urlCache = new Map<string, { url: string; expires: number }>();

/** mediaBase: the chat's base address, e.g. /api/communities/:id/conversation
 * or /api/private-messages/conversations/:id. */
export async function getAttachmentUrl(mediaBase: string, messageId: string, attachmentId: string): Promise<string> {
  const hit = urlCache.get(attachmentId);
  if (hit && hit.expires > Date.now()) return hit.url;
  const res = await api.get<{ url: string; expiresAt?: string }>(
    `${mediaBase}/messages/${messageId}/attachments/${attachmentId}/download-url`,
  );
  // Keep the link until 10 minutes before it stops working (at least 4 min).
  const until = res.expiresAt ? new Date(res.expiresAt).getTime() - 10 * 60 * 1000 : 0;
  urlCache.set(attachmentId, { url: res.url, expires: Math.max(until, Date.now() + 4 * 60 * 1000) });
  return res.url;
}

/** True once the element has scrolled into view (always true where the
 * browser can't tell). */
export function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (inView || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [inView]);
  return [ref, inView];
}

export function useAttachmentUrl(mediaBase: string, messageId: string, attachmentId: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || url) return;
    let alive = true;
    getAttachmentUrl(mediaBase, messageId, attachmentId)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [enabled, url, mediaBase, messageId, attachmentId]);
  return { url, failed };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
