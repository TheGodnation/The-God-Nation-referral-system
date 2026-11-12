import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

// A link to one of the plain help pages (install, notifications, phone settings). It opens as a panel over the app, in
// place, instead of a new window or tab: from inside the app (or with the app installed) a new window could open blank
// or throw the person out of the app, and some phone browsers refuse a new tab. So there is no new-tab link at all.
export function GuideLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={t('guideViewer.title') ?? ''} data-testid="guide-viewer">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
              <button type="button" onClick={() => setOpen(false)} className="btn-primary px-4 py-1.5 text-sm" data-testid="guide-close">
                ← {t('guideViewer.close')}
              </button>
            </div>
            <iframe title={t('guideViewer.title') ?? ''} src={href} className="min-h-0 w-full flex-1 border-0" data-testid="guide-frame" />
          </div>,
          document.body,
        )}
    </>
  );
}
