import { api, ApiError } from './api';

// Pictures for Knowledge Centre articles. The photo is shrunk on the phone first (long side at most
// 1600 px, a JPEG of a few hundred KB, which also drops any hidden photo data such as the place it
// was taken), sent straight to storage, and then registered. Visitors on slow connections download
// the small version, never the original.

export const MAX_SIDE = 1600;
const TARGET_BYTES = 450_000;

export interface Prepared { blob: Blob; mimeType: 'image/jpeg'; width: number; height: number }
export interface MediaItem { id: string; url: string; byteSize: number; width: number; height: number; altEn: string | null; altFr: string | null; inUse?: boolean }

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to the older way
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

export async function prepareImage(file: Blob): Promise<Prepared> {
  const img = await decode(file);
  try {
    let side = MAX_SIDE;
    for (let round = 0; round < 3; round++) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.fillStyle = '#fff'; // pictures with see-through parts get a white background
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img.source, 0, 0, width, height);
      for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
        const blob = await toBlob(canvas, q);
        if (blob && blob.size <= TARGET_BYTES) return { blob, mimeType: 'image/jpeg', width, height };
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('too big');
  } finally {
    img.close?.();
  }
}

function putToStorage(url: string, blob: Blob, mimeType: string, onProgress: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total); };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.send(blob);
  });
}

export type UploadStage = 'preparing' | 'sending' | 'saving';
export class PictureError extends Error {
  constructor(public reason: 'read' | 'storage_off' | 'send' | 'register', message?: string) { super(message ?? reason); }
}

/** Shrinks, sends and registers one picture. `base` is the Knowledge Centre API address. */
export async function uploadPicture(base: string, file: Blob, onStage: (s: UploadStage, fraction?: number) => void, prepare: (f: Blob) => Promise<Prepared> = prepareImage): Promise<MediaItem> {
  onStage('preparing');
  let prepared: Prepared;
  try { prepared = await prepare(file); } catch { throw new PictureError('read'); }
  let auth: { id: string; uploadUrl: string };
  try {
    auth = await api.post(`${base}/media/authorize`, { mimeType: prepared.mimeType, byteSize: prepared.blob.size });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) throw new PictureError('storage_off');
    throw new PictureError('register', err instanceof ApiError ? err.message : undefined);
  }
  onStage('sending', 0);
  if (!(await putToStorage(auth.uploadUrl, prepared.blob, prepared.mimeType, (f) => onStage('sending', f)))) throw new PictureError('send');
  onStage('saving');
  try {
    return await api.post<MediaItem>(`${base}/media/${auth.id}/finalize`, { mimeType: prepared.mimeType, width: prepared.width, height: prepared.height });
  } catch (err) {
    throw new PictureError('register', err instanceof ApiError ? err.message : undefined);
  }
}
