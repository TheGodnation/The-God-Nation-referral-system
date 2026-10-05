export interface ChatAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
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
}

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function mediaKind(mime: string | null | undefined): 'photo' | 'video' | 'voice' | 'document' | null {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return 'document';
}
