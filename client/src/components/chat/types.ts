export interface ChatAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  /** Tiny blurred preview (data URL) shown before the photo downloads. */
  thumb?: string;
}

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ChatReplyPreview {
  id: string;
  senderName: string;
  body: string | null;
  deleted: boolean;
  attachmentMimeType: string | null;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderPhotoUrl?: string | null;
  isOwn: boolean;
  body: string | null;
  createdAt: string;
  deleted: boolean;
  attachments: ChatAttachment[];
  replyTo?: ChatReplyPreview | null;
  reactions?: ChatReaction[];
  /** Shown while a message is still being sent. */
  pending?: boolean;
  /** Typed while offline — will be sent when the network comes back. */
  queued?: boolean;
  /** Ticks on your own messages: ✓ sent, ✓✓ received, blue ✓✓ seen. */
  status?: 'sent' | 'delivered' | 'read';
  /** Deleted for everyone by the person who sent it (vs removed by a leader). */
  deletedBySender?: boolean;
  /** Changed after sending — "edited" next to the time. */
  edited?: boolean;
  /** A copy of a message from another chat — "↪ Forwarded". */
  forwarded?: boolean;
}

/** Edit allowed for 15 minutes; delete for everyone for 2 days (like WhatsApp). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const UNSEND_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export function canEditMessage(m: ChatMessage, now = Date.now()) {
  return m.isOwn && !m.deleted && !m.pending && !m.queued && Boolean(m.body) && now - new Date(m.createdAt).getTime() <= EDIT_WINDOW_MS;
}

export function canUnsendMessage(m: ChatMessage, now = Date.now()) {
  return m.isOwn && !m.deleted && !m.pending && !m.queued && now - new Date(m.createdAt).getTime() <= UNSEND_WINDOW_MS;
}

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function mediaKind(mime: string | null | undefined): 'photo' | 'video' | 'voice' | 'document' | null {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return 'document';
}
