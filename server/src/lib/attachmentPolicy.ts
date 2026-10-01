import crypto from 'crypto';

// Phase 3M.8C — Community message attachments: MIME allow-list and
// per-category size ceilings, chosen conservatively for Cameroon mobile
// networks and this application's modest (Render free/starter) hosting —
// see the Phase 3M.8C architecture report for the provider-constraint
// findings behind these exact numbers (no Render/R2 hard limit dictates
// them; these are the deliberately conservative values chosen given the
// absence of one). Server validation here is authoritative; any client-side
// check is UX only. Deliberately a short, explicit allow-list — no
// executables, scripts, HTML, or SVG (XSS risk via inline scripts/onload
// handlers in SVG markup), and no generic "application/*" catch-all.
export const ATTACHMENT_MIME_LIMITS: Record<string, number> = {
  'image/jpeg': 8 * 1024 * 1024,
  'image/png': 8 * 1024 * 1024,
  'image/webp': 8 * 1024 * 1024,
  'application/pdf': 15 * 1024 * 1024,
  'audio/mpeg': 20 * 1024 * 1024,
  'audio/ogg': 20 * 1024 * 1024,
  'audio/mp4': 20 * 1024 * 1024,
  'video/mp4': 60 * 1024 * 1024,
  'video/webm': 60 * 1024 * 1024,
};

// Kept small and fixed — this is a chat message, not a bulk file-sharing
// tool. Enforced at message-creation time (the only point that actually
// counts attachments per message); the upload-authorization route issues
// one storage key per call and does not itself track a running count.
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const MAX_ORIGINAL_FILENAME_LENGTH = 200;

export function isAllowedAttachmentMime(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_MIME_LIMITS, mimeType);
}

export function maxBytesForMime(mimeType: string): number | undefined {
  return ATTACHMENT_MIME_LIMITS[mimeType];
}

// A display-only filename — never used to construct a storage path (the
// storage key is always server-generated, see below). Rejects empty,
// oversized, and path-traversal-shaped names; otherwise permissive, since
// this is never interpreted as a path or executed.
export function isValidOriginalFilename(filename: string): boolean {
  const trimmed = filename.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ORIGINAL_FILENAME_LENGTH) return false;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) return false;
  return true;
}

// Server-generated, opaque, and namespaced to the exact Community it was
// authorized for — this is what makes "arbitrary storage key rejected" and
// "attachment cannot be attached to another Community message" enforceable
// without a separate persisted "pending upload" table: a storage key that
// doesn't match this exact shape for the communityId in the request can
// never have been issued by authorizeAttachmentUpload for that Community,
// so message creation's own validateStorageKeyForCommunity check (below)
// rejects it outright, before any R2 call is ever made.
const STORAGE_KEY_PATTERN =
  /^communities\/([0-9a-f-]{36})\/attachments\/([0-9a-f-]{36})$/;

export function generateStorageKey(communityId: string): string {
  return `communities/${communityId}/attachments/${crypto.randomUUID()}`;
}

export function isStorageKeyForCommunity(storageKey: string, communityId: string): boolean {
  const match = STORAGE_KEY_PATTERN.exec(storageKey);
  if (!match) return false;
  return match[1] === communityId;
}

// Media Phase 1 (HeadquartersPost media) — reuses every MIME/size rule and
// filename check above as-is (no new allow-list, no new limits). Only the
// storage-key namespace and the mime-to-coarse-category mapping are new,
// mirroring the exact generateStorageKey/isStorageKeyForCommunity pattern
// above for a HeadquartersPost instead of a Community.
const HEADQUARTERS_POST_MEDIA_KEY_PATTERN =
  /^headquarters-posts\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})$/;

export function generateHeadquartersPostMediaStorageKey(headquartersPostId: string): string {
  return `headquarters-posts/${headquartersPostId}/media/${crypto.randomUUID()}`;
}

export function isStorageKeyForHeadquartersPostMedia(storageKey: string, headquartersPostId: string): boolean {
  const match = HEADQUARTERS_POST_MEDIA_KEY_PATTERN.exec(storageKey);
  if (!match) return false;
  return match[1] === headquartersPostId;
}

export type HeadquartersPostMediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'PDF';

// Only ever called after isAllowedAttachmentMime(mimeType) has already
// passed, so every mime currently in ATTACHMENT_MIME_LIMITS resolves to
// exactly one of the four kinds below — null is unreachable in practice,
// kept only so a future addition to the allow-list can't silently fall
// through to an invalid mediaType.
export function mediaKindForMime(mimeType: string): HeadquartersPostMediaKind | null {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  if (mimeType === 'application/pdf') return 'PDF';
  return null;
}
