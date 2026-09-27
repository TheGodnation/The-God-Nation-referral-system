// Phase 3M.8C — mirrors server/src/lib/attachmentPolicy.ts's
// ATTACHMENT_MIME_LIMITS exactly. This is UX only (an early, friendly
// rejection before spending an upload-authorization round trip) — the
// server re-validates everything authoritatively and never trusts this.
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

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export function isAllowedAttachmentMime(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ATTACHMENT_MIME_LIMITS, mimeType);
}

export function maxBytesForMime(mimeType: string): number | undefined {
  return ATTACHMENT_MIME_LIMITS[mimeType];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
