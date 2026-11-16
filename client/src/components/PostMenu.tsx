import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface PostMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

// The "⋯" button on a post (like WhatsApp's menu): tap it, then pick an action such as Edit.
export function PostMenu({ items, testId }: { items: PostMenuItem[]; testId?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rounded-full px-2.5 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100"
        aria-label={t('postMenu.more') ?? ''}
        title={t('postMenu.more') ?? ''}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${it.danger ? 'text-red-700' : 'text-slate-800'}`}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
