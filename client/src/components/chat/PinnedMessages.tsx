import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** A message the central admin pinned to the top of an assembly's chat. */
export interface ChatPin {
  messageId: string;
  senderName: string;
  senderBadge?: string | null;
  body: string | null;
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
  if (text) return text;
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
  pins,
  canPin,
  onSeen,
  onShowInChat,
  onUnpin,
}: {
  pins: ChatPin[];
  canPin: boolean;
  onSeen: (messageId: string) => void;
  onShowInChat: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
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

  function step(delta: number) {
    const next = (index + delta + pins.length) % pins.length;
    setIndex(next);
    if (pins[next].unseen) onSeen(pins[next].messageId);
  }

  const text = previewOf(current, t as (k: string) => string);
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
          {(!gold || open) && <span className={open ? 'mt-0.5 block whitespace-pre-wrap break-words' : 'mt-0.5 block truncate'}>{text}</span>}
        </span>
        <span aria-hidden className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {pins.length > 1 && (
            <>
              <button type="button" className="font-semibold text-brand-700 underline" onClick={() => step(-1)}>
                ← {t('pins.previous')}
              </button>
              <button type="button" className="font-semibold text-brand-700 underline" onClick={() => step(1)}>
                {t('pins.next')} →
              </button>
            </>
          )}
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => onShowInChat(current.messageId)}>
            {t('pins.show_in_chat')}
          </button>
          {canPin && (
            <button type="button" className="font-semibold text-red-700 underline" onClick={() => onUnpin(current.messageId)}>
              {t('pins.unpin')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
