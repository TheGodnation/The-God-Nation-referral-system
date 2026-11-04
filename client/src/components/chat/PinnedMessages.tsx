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

/**
 * The heading of a pin: a teaching's title, or the first line of a post (a "## heading" without its
 * symbols), or the kind of attachment. `rest` is what follows, for a short preview under it.
 */
export function pinHeading(p: ChatPin, t: (k: string) => string): { heading: string; rest: string } {
  if (p.teachingTitle) return { heading: p.teachingTitle, rest: '' };
  const text = (p.translation?.translatedBody ?? p.body ?? '').trim();
  if (text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const first = plainPreview(lines[0] ?? '');
    const rest = plainPreview(lines.slice(1).join(' '));
    return { heading: first, rest };
  }
  return { heading: pinPreview(p, t), rest: '' };
}

// The card under the chat header, so a person who enters an assembly sees at once that there are
// pinned messages for them: a clear "Pinned messages" heading with how many there are (and how many are
// new), the heading of the one to read next with the start of it, a progress bar, and a "Read now" /
// "Continue" button. Tapping it opens the Pinned page, where the pinned messages are read, taken (a
// teaching's quiz) and commented on one after another, without going into the chat. It carries on at the
// first one the person has not finished. It turns gold when something new was pinned.
export function PinnedMessages({ pins, onOpen }: { pins: ChatPin[]; onOpen: (messageId: string) => void }) {
  const { t } = useTranslation();
  const list = useMemo(() => orderedPins(pins), [pins]);
  if (list.length === 0) return null;

  const unseenList = list.filter((p) => p.unseen && !p.done);
  const next = resumePin(list)!;
  const doneCount = list.filter((p) => p.done).length;
  const allDone = doneCount === list.length;
  const target = unseenList[0] ?? next;
  const gold = unseenList.length > 0;
  const { heading, rest } = pinHeading(target, t as (k: string) => string);
  const percent = Math.round((doneCount / list.length) * 100);

  return (
    <div className={`border-b px-3 py-2.5 shadow-sm ${gold ? 'border-amber-300 bg-amber-100 text-amber-950' : 'border-slate-200 bg-white text-slate-800'}`} data-testid="pinned-messages">
      <button type="button" className="block w-full text-left" onClick={() => onOpen(target.messageId)} data-testid="pinned-open">
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-base">📌</span>
          <span className="whitespace-nowrap text-sm font-bold">{t('pins.strip_title')}</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white" data-testid="pinned-count">
            {list.length}
          </span>
          {gold && (
            <span className="whitespace-nowrap rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white" data-testid="important-chip">
              {t('pins.n_new', { count: unseenList.length })}
            </span>
          )}
          <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-brand-700 px-3 py-1 text-xs font-semibold text-white">{allDone && !gold ? t('pins.open') : gold ? t('pins.read_short') : t('pins.continue')} ›</span>
        </span>
        <span className="mt-1.5 block" data-testid="pinned-next-preview">
          <span
            className={`block text-[15px] font-semibold ${rest ? 'truncate' : ''}`}
            style={rest ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}
          >
            {heading}
          </span>
          {rest && <span className="block truncate text-sm opacity-80">{rest}</span>}
        </span>
        <span className="mt-1.5 flex items-center gap-2 text-xs font-medium opacity-80">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
          </span>
          <span>{t('pins.done_of', { done: doneCount, total: list.length })}</span>
        </span>
      </button>
    </div>
  );
}
