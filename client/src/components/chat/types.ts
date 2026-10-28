export interface ChatAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  /** Tiny blurred preview (data URL) shown before the photo downloads — for
   * a PDF, the top of its first page. */
  thumb?: string;
  /** A PDF's number of pages ("71 pages • 3.5 MB • PDF"). */
  pageCount?: number;
}

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Present only once a background translation has landed, and only when it
 * differs from the viewer's own language — see communityConversations.ts's
 * own translationField(). */
export interface ChatTranslation {
  sourceLanguage: 'en' | 'fr';
  translatedBody: string;
}

/** A voice note's transcript — shown whenever it's ready, regardless of
 * language; `translated`/`original` only apply when the spoken language
 * differs from the viewer's. See communityConversations.ts's own
 * transcriptField(). */
export interface ChatTranscript {
  sourceLanguage: 'en' | 'fr';
  text: string;
  translated: boolean;
  original: string | null;
}

export interface ChatReplyPreview {
  id: string;
  senderName: string;
  body: string | null;
  deleted: boolean;
  attachmentMimeType: string | null;
}

/** A teaching posted in an assembly (shown as a card): see TeachingCard. */
export interface ChatTeaching {
  id: string;
  title: string;
  mediaKind: 'AUDIO' | 'VIDEO' | 'PDF' | null;
  hasText: boolean;
  closesAt: string;
  /** Where the viewer is: not opened, started, finished (quiz open), passed, failed. */
  myState: 'NEW' | 'STARTED' | 'FINISHED' | 'PASSED' | 'FAILED';
  myPercentage: number | null;
  /** How the whole assembly is doing (the author is not counted). */
  totals?: { members: number; finished: number; taken: number; passed: number } | null;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderPhotoUrl?: string | null;
  /** "National Coordinator" — the central admin. */
  senderBadge?: string | null;
  /** Tapping the sender's photo/name opens /member/people/:id — absent for your own messages. */
  senderPersonId?: string | null;
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
  translation?: ChatTranslation | null;
  transcript?: ChatTranscript | null;
  teaching?: ChatTeaching | null;
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
