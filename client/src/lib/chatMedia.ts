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
  /** Tiny blurred preview of a photo (a few KB) for slow networks. */
  thumb?: string;
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

/** authorizePath: the chat's "ask for an upload link" address (group or private chat). */
export async function uploadChatFile(authorizePath: string, file: Blob, filename: string): Promise<UploadedAttachment> {
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

  const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body }).catch(() => null);
  if (!put || !put.ok) throw new ChatUploadError('failed');
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
  try {
    const bitmap = await createImageBitmap(file);
    if (allowed && file.size <= SHRINK_ABOVE_BYTES && Math.max(bitmap.width, bitmap.height) <= maxSide) return file;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!blob) return file;
    return allowed && blob.size >= file.size ? file : blob;
  } catch {
    return file;
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
