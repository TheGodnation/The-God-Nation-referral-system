import { api, ApiError } from './api';
import { baseMime, shrinkPhoto } from './chatMedia';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export type ProfileImageProblem = 'type' | 'size' | 'storage' | 'failed';

export class ProfileImageError extends Error {
  reason: ProfileImageProblem;
  constructor(reason: ProfileImageProblem) {
    super(reason);
    this.reason = reason;
  }
}

/** Uploads the member's own profile picture ("photo") or wall cover
 * ("cover"). Big phone photos are made smaller first. */
export async function uploadProfileImage(kind: 'photo' | 'cover', file: File): Promise<void> {
  const blob = await shrinkPhoto(file);
  const mimeType = baseMime(blob.type);
  if (!ALLOWED.includes(mimeType)) throw new ProfileImageError('type');
  if (blob.size > MAX_BYTES) throw new ProfileImageError('size');
  try {
    const auth = await api.post<{ storageKey: string; uploadUrl: string }>(`/api/member/me/${kind}/authorize`, {
      mimeType,
      byteSize: blob.size,
    });
    const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: blob });
    if (!put.ok) throw new ProfileImageError('failed');
    await api.post(`/api/member/me/${kind}`, { storageKey: auth.storageKey, mimeType, byteSize: blob.size });
  } catch (err) {
    if (err instanceof ProfileImageError) throw err;
    if (err instanceof ApiError && err.code === 'STORAGE_UNAVAILABLE') throw new ProfileImageError('storage');
    if (err instanceof ApiError && err.code === 'TOO_LARGE') throw new ProfileImageError('size');
    if (err instanceof ApiError && err.code === 'UNSUPPORTED_TYPE') throw new ProfileImageError('type');
    throw new ProfileImageError('failed');
  }
}

export async function removeProfileImage(kind: 'photo' | 'cover'): Promise<void> {
  await api.delete(`/api/member/me/${kind}`);
}
