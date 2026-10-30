import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { RichText } from '../lib/richText';

// "Read in comfort": a long text (a voice-note transcript, a translation, a
// long message) on its own full screen, in big type with room between the
// paragraphs and around the headings, with A− / A+ that is remembered.
const SIZES = [16, 18, 20, 23, 27];
const KEY = 'comfort-size';

function readSize(): number {
  try {
    const saved = Number(localStorage.getItem(KEY));
    return SIZES.includes(saved) ? saved : 18;
  } catch {
    return 18;
  }
}

export function ComfortReader({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [size, setSize] = useState(readSize);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function change(direction: 1 | -1) {
    const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + direction))];
    setSize(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      /* the size is just not remembered */
    }
  }

  // On the page itself, not inside the message bubble (a swiped bubble would move it).
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="comfort-reader">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button type="button" onClick={onClose} aria-label={t('comfort.close') ?? ''} className="rounded px-2 py-1 text-2xl leading-none text-slate-600">
          ×
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{title}</p>
        <button type="button" onClick={() => change(-1)} disabled={size <= SIZES[0]} aria-label={t('comfort.smaller') ?? ''} className="btn-secondary px-3 py-1 text-sm disabled:opacity-40">
          A−
        </button>
        <button type="button" onClick={() => change(1)} disabled={size >= SIZES[SIZES.length - 1]} aria-label={t('comfort.bigger') ?? ''} className="btn-secondary px-3 py-1 text-base font-bold disabled:opacity-40">
          A+
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div style={{ fontSize: size }}>
          <RichText className="mx-auto max-w-2xl break-words leading-[1.9] text-slate-900" text={text} headings comfort data-testid="comfort-text" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The small "Read in comfort" button shown under long text. */
export function ComfortButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="mt-1 text-sm font-semibold text-emerald-700 underline"
    >
      {t('comfort.open')}
    </button>
  );
}
