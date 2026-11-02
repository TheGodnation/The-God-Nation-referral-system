import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// A book cover opened big, like a profile photo: it fills the screen so the
// title and words on it can be read; tap the picture (or "Zoom in") to come
// closer and drag to look around; "Back to the book", the ✕, the dark space
// around it or the Back key return to the book page. When the book can be
// read, a button below goes straight into it.
export function BookCoverViewer({
  url,
  alt,
  onClose,
  readHref,
  readLabel,
}: {
  url: string;
  alt: string;
  onClose: () => void;
  readHref?: string;
  readLabel?: string;
}) {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const backRef = useRef<HTMLButtonElement | null>(null);
  // The latest onClose, so the effect below runs once (not on every zoom).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    backRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    // The page behind stays still while the cover is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-50 flex flex-col bg-black/95" data-testid="cover-viewer">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white">
        <button ref={backRef} type="button" onClick={onClose} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
          ← {t('school.cover_back')}
        </button>
        <button type="button" onClick={onClose} aria-label={t('school.cover_close') ?? ''} className="px-2 text-2xl leading-none">
          ✕
        </button>
      </div>

      {/* The picture sits in the middle; zoomed in, it is larger than the screen and can be dragged around. */}
      <div
        className="flex min-h-0 flex-1 overflow-auto overscroll-contain"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <img
          src={url}
          alt={alt}
          draggable={false}
          onClick={() => setZoomed((z) => !z)}
          data-zoomed={zoomed ? 'true' : 'false'}
          className={`m-auto select-none ${zoomed ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}`}
          style={zoomed ? { width: '220%' } : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3">
        <button type="button" onClick={() => setZoomed((z) => !z)} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20">
          {zoomed ? `🔍 ${t('school.cover_zoom_out')}` : `🔍 ${t('school.cover_zoom_in')}`}
        </button>
        {readHref && readLabel && (
          <Link to={readHref} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-brand-500">
            📖 {readLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
