import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RichText, plainPreview } from '../../lib/richText';

/** A message the central admin pinned to the top of an assembly's chat. */
export interface ChatPin {
  messageId: string;
  senderName: string;
  senderBadge?: string | null;
  body: string | null;
  /** The list carries only the start of it; "loadFull" gets the rest when it is read. */
  bodyTruncated?: boolean;
  translation?: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null;
  teachingTitle?: string | null;
  attachmentMimeType?: string | null;
  createdAt: string;
  pinnedAt: string;
  /** Pinned since the viewer last looked: the gold "Important" chip shows for it. */
  unseen: boolean;
}

function previewOf(p: ChatPin, t: (k: string) => string): string {
  const text = p.translation?.translatedBody ?? p.body;
  if (text) return plainPreview(text); // no formatting symbols in a one-line preview
  if (p.teachingTitle) return `📚 ${p.teachingTitle}`;
  if (p.attachmentMimeType?.startsWith('image/')) return `📷 ${t('groupChat.photo')}`;
  if (p.attachmentMimeType?.startsWith('audio/')) return `🎤 ${t('groupChat.voice')}`;
  if (p.attachmentMimeType?.startsWith('video/')) return `🎥 ${t('groupChat.video')}`;
  if (p.attachmentMimeType) return `📄 ${t('groupChat.document_label')}`;
  return '';
}

// The strip under the chat header: the pinned messages stay here however many
// messages come after them, so a newcomer sees them first. When one is unseen,
// the strip turns gold with "Important message, tap to read"; tapping opens
// it in full and counts it as seen. The central admin can unpin from here.
export function PinnedMessages({
  pins: pinsIn,
  canPin,
  onSeen,
  onShowInChat,
  onUnpin,
  loadFull,
}: {
  pins: ChatPin[];
  canPin: boolean;
  onSeen: (messageId: string) => void;
  onShowInChat: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
  /** Fetches one pinned message in full (the list carries only its start). */
  loadFull?: (messageId: string) => Promise<{ body: string | null; translation?: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null }>;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [full, setFull] = useState<Record<string, { body: string | null; translation?: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null } | 'failed'>>({});
  // Read in the order they were written (a series of teachings goes 1, 2, 3…); equal dates keep the list's order.
  const pins = useMemo(() => [...pinsIn].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [pinsIn]);
  const shownId = pins.length ? pins[Math.min(index, pins.length - 1)].messageId : null;
  const shownTruncated = pins.length ? pins[Math.min(index, pins.length - 1)].bodyTruncated : false;
  // Reading one that is longer than the list carries: fetch the whole of it.
  useEffect(() => {
    if (!open || !shownId || !shownTruncated || !loadFull || full[shownId]) return;
    let live = true;
    loadFull(shownId)
      .then((r) => live && setFull((f) => ({ ...f, [shownId]: r })))
      .catch(() => live && setFull((f) => ({ ...f, [shownId]: 'failed' })));
    return () => {
      live = false;
    };
  }, [open, shownId, shownTruncated, loadFull, full]);
  if (pins.length === 0) return null;

  const firstUnseen = pins.findIndex((p) => p.unseen);
  const current = pins[Math.min(index, pins.length - 1)];
  const unseenCount = pins.filter((p) => p.unseen).length;

  function openOrClose() {
    if (open) {
      setOpen(false);
      return;
    }
    // Tapping the gold chip goes straight to the pin nobody has read yet.
    const target = current.unseen ? pins.indexOf(current) : firstUnseen >= 0 ? firstUnseen : pins.indexOf(current);
    setIndex(target);
    setOpen(true);
    const shown = pins[target];
    if (shown.unseen) onSeen(shown.messageId);
  }

  const at = Math.min(index, pins.length - 1);
  const isLast = at === pins.length - 1;

  function step(delta: number) {
    const next = Math.min(Math.max(at + delta, 0), pins.length - 1);
    setIndex(next);
    if (pins[next].unseen) onSeen(pins[next].messageId);
  }

  /** The last one is read: back to the chat (the next time it is opened, it starts again from the first). */
  function finish() {
    setOpen(false);
    setShowAll(false);
    setIndex(0);
  }

  const text = previewOf(current, t as (k: string) => string);
  // What is read when it is open: the whole message (fetched when the list carries only its start), set out like a teaching.
  const fetched = full[current.messageId];
  const whole = typeof fetched === 'object' ? (fetched.translation?.translatedBody ?? fetched.body) : (current.translation?.translatedBody ?? current.body);
  const loadingWhole = Boolean(current.bodyTruncated && loadFull && !fetched);
  const gold = unseenCount > 0;

  return (
    <div
      className={`border-b px-3 py-2 text-sm shadow-sm ${gold ? 'border-amber-300 bg-amber-100 text-amber-950' : 'border-slate-200 bg-white text-slate-800'}`}
      data-testid="pinned-messages"
    >
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={openOrClose} aria-expanded={open}>
        <span aria-hidden className="mt-0.5">📌</span>
        <span className="min-w-0 flex-1">
          {gold && !open ? (
            <span className="font-semibold" data-testid="important-chip">
              {t('pins.important_chip')}
            </span>
          ) : (
            <span className="block text-xs font-semibold text-slate-500">
              {pins.length > 1 ? t('pins.n_of', { current: Math.min(index, pins.length - 1) + 1, total: pins.length }) : t('pins.pinned')} · {current.senderName}
            </span>
          )}
          {(!gold || open) && !open && <span className="mt-0.5 block truncate">{text}</span>}
        </span>
        <span aria-hidden className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-[55vh] overflow-y-auto rounded-lg bg-white/70 px-2 py-2 text-[15px] leading-relaxed" data-testid="pinned-reader">
          {whole ? <RichText text={whole} headings comfort /> : <p className="whitespace-pre-wrap break-words">{text}</p>}
          {loadingWhole && <p className="mt-2 text-xs text-slate-500">{t('pins.loading_full')}</p>}
        </div>
      )}
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {pins.length > 1 && at > 0 && (
            <button type="button" className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-brand-700 ring-1 ring-slate-300" onClick={() => step(-1)}>
              ← {t('pins.previous')}
            </button>
          )}
          {isLast ? (
            <button type="button" className="rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white" onClick={finish}>
              {pins.length > 1 ? t('pins.finish') : t('pins.close')} ✓
            </button>
          ) : (
            <button type="button" className="rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white" onClick={() => step(1)}>
              {t('pins.next')} →
            </button>
          )}
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => onShowInChat(current.messageId)}>
            {t('pins.show_in_chat')}
          </button>
          {pins.length > 1 && (
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? t('pins.hide_all') : t('pins.see_all', { count: pins.length })}
            </button>
          )}
          {canPin && (
            <button type="button" className="font-semibold text-red-700 underline" onClick={() => onUnpin(current.messageId)}>
              {t('pins.unpin')}
            </button>
          )}
        </div>
      )}
      {open && showAll && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-slate-800" data-testid="pinned-list">
          {pins.map((p, i) => (
            <li key={p.messageId} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setIndex(i);
                  if (p.unseen) onSeen(p.messageId);
                  onShowInChat(p.messageId);
                }}
              >
                <span className="block text-xs font-semibold text-slate-500">
                  {i + 1}. {p.senderName}
                  {p.unseen ? ' · ●' : ''}
                </span>
                <span className="line-clamp-2 block whitespace-pre-wrap break-words text-sm">{previewOf(p, t as (k: string) => string)}</span>
              </button>
              {canPin && (
                <button type="button" className="shrink-0 px-1 text-xs font-semibold text-red-700 underline" onClick={() => onUnpin(p.messageId)}>
                  {t('pins.unpin')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
