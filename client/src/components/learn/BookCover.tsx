import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// A Leadership School book cover: the cover picture when there is one, or
// a drawn cover (school name, book number, title) until the admin uploads
// the book. `compact` covers (small thumbnails) draw only the number.
export function BookCover({
  number,
  title,
  coverUrl,
  coverUrlFr = null,
  compact = false,
  className = '',
}: {
  number: number;
  title: string;
  coverUrl: string | null;
  /** The French cover, shown instead when the app is in French. */
  coverUrlFr?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = t('school.cover_alt', { number, title });
  const shown = coverUrlFr && i18n.language?.startsWith('fr') ? coverUrlFr : coverUrl;
  if (shown && shown !== failedUrl) {
    return (
      <img
        src={shown}
        alt={label}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(shown)}
        className={`aspect-[2/3] w-full rounded-md bg-slate-200 object-cover shadow ${className}`}
      />
    );
  }
  if (compact) {
    return (
      <div
        role="img"
        aria-label={label}
        className={`flex aspect-[2/3] w-full items-center justify-center rounded bg-gradient-to-br from-brand-600 via-brand-800 to-brand-950 text-lg font-bold text-amber-300 shadow ${className}`}
      >
        {number}
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex aspect-[2/3] w-full flex-col justify-between overflow-hidden rounded-md bg-gradient-to-br from-brand-600 via-brand-800 to-brand-950 p-2.5 text-white shadow ${className}`}
    >
      <span className="text-[9px] font-semibold uppercase leading-tight tracking-widest text-brand-100">{t('school.name')}</span>
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-amber-300">{t('learn.book', { number })}</span>
        <span className="line-clamp-4 block text-sm font-bold leading-snug">{title}</span>
      </span>
    </div>
  );
}
