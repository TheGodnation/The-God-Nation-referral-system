import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { plainPreview } from '../../lib/richText';

/** A message the central admin pinned to the top of an assembly's chat. */
export interface ChatPin {
  messageId: string;
  senderName: string;
  senderBadge?: string | null;
  body: string | null;
  /** The list carries only the start of it; the pinned page fetches the rest. */
  bodyTruncated?: boolean;
  translation?: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null;
  teachingTitle?: string | null;
  /** Set when the pin is a teaching: its reading and quiz open from the pinned page. */
  teachingId?: string | null;
  /** The viewer is done with it: a teaching's quiz taken, or a post opened. */
  done?: boolean;
  commentCount?: number;
  attachmentMimeType?: string | null;
  createdAt: string;
  pinnedAt: string;
  /** Pinned since the viewer last looked: the gold "Important" chip shows for it. */
  unseen: boolean;
}

/** Read in the order they were written (a series of teachings goes 1, 2, 3…); equal dates keep the list's order. */
export function orderedPins(pins: ChatPin[]): ChatPin[] {
  return [...pins].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Where a person carries on: the first pin they have not finished (the first one when all are done). */
export function resumePin(pins: ChatPin[]): ChatPin | null {
  const list = orderedPins(pins);
  return list.find((p) => !p.done) ?? list[0] ?? null;
}

export function pinPreview(p: ChatPin, t: (k: string) => string): string {
  const text = p.translation?.translatedBody ?? p.body;
  if (text) return plainPreview(text); // no formatting symbols in a one-line preview
  if (p.teachingTitle) return `📚 ${p.teachingTitle}`;
  if (p.attachmentMimeType?.startsWith('image/')) return `📷 ${t('groupChat.photo')}`;
  if (p.attachmentMimeType?.startsWith('audio/')) return `🎤 ${t('groupChat.voice')}`;
  if (p.attachmentMimeType?.startsWith('video/')) return `🎥 ${t('groupChat.video')}`;
  if (p.attachmentMimeType) return `📄 ${t('groupChat.document_label')}`;
  return '';
}

// The strip under the chat header. Tapping it opens the Pinned page, where the
// pinned messages are read, taken (a teaching's quiz) and commented on one after
// another, without going into the chat. It carries on at the first one the person
// has not finished. When something was pinned since the person last looked, the
// strip turns gold: "Important message, tap to read".
export function PinnedMessages({ pins, onOpen }: { pins: ChatPin[]; onOpen: (messageId: string) => void }) {
  const { t } = useTranslation();
  const list = useMemo(() => orderedPins(pins), [pins]);
  if (list.length === 0) return null;

  const unseen = list.find((p) => p.unseen);
  const next = resumePin(list)!;
  const doneCount = list.filter((p) => p.done).length;
  const allDone = doneCount === list.length;
  const target = unseen && !unseen.done ? unseen : next;
  const gold = Boolean(unseen);

  return (
    <div
      className={`border-b px-3 py-2 text-sm shadow-sm ${gold ? 'border-amber-300 bg-amber-100 text-amber-950' : 'border-slate-200 bg-white text-slate-800'}`}
      data-testid="pinned-messages"
    >
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => onOpen(target.messageId)} data-testid="pinned-open">
        <span aria-hidden>📌</span>
        <span className="min-w-0 flex-1">
          {gold ? (
            <span className="font-semibold" data-testid="important-chip">
              {t('pins.important_chip')}
            </span>
          ) : (
            <>
              <span className="block text-xs font-semibold text-slate-500">
                {t('pins.strip_title')} · {t('pins.done_of', { done: doneCount, total: list.length })}
              </span>
              <span className="mt-0.5 block truncate" data-testid="pinned-next-preview">
                {pinPreview(next, t as (k: string) => string)}
              </span>
            </>
          )}
        </span>
        <span className="shrink-0 rounded-full bg-brand-700 px-3 py-1 text-xs font-semibold text-white">{allDone && !gold ? t('pins.open') : t('pins.continue')} ›</span>
      </button>
    </div>
  );
}
