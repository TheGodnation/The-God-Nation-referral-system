import { useTranslation } from 'react-i18next';

// Our motto, set apart as one gold statement on a deep-blue panel with a faint
// globe behind it. Shown on the About page and on the public Home page.
export function MottoCard() {
  const { t } = useTranslation();
  return (
    <article
      className="relative overflow-hidden rounded-xl border border-gold-400/70 bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-6 py-9 text-center shadow-lg"
      aria-labelledby="about-motto"
      data-testid="about-motto"
    >
      {/* A faint globe behind the words: rings and meridians, the whole world within reach. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold-400/15" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold-400/15" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold-400/10" />
      <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gold-400/15 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-brand-500/30 blur-2xl" />
      <h2 id="about-motto" className="relative flex items-center justify-center gap-3 text-xs font-bold uppercase tracking-[0.3em] text-gold-400">
        <span aria-hidden className="h-px w-8 bg-gold-400/70" />
        <span aria-hidden>✦</span>
        {t('aboutGodNation.motto_title')}
        <span aria-hidden>✦</span>
        <span aria-hidden className="h-px w-8 bg-gold-400/70" />
      </h2>
      <blockquote className="relative mt-5">
        <span aria-hidden className="block font-serif text-6xl leading-none text-gold-400/50">“</span>
        {/* One statement. Its call to go is set in bold capitals, the rest flows on in italic. */}
        <p className="-mt-6 font-serif text-xl leading-relaxed text-gold-400 sm:text-2xl" data-testid="about-motto-text">
          <span className="block bg-gradient-to-r from-gold-400 via-yellow-200 to-gold-400 bg-clip-text text-[1.35rem] font-bold uppercase not-italic leading-snug tracking-wide text-transparent sm:text-3xl">
            {t('aboutGodNation.motto_lead')}
          </span>{' '}
          <span className="mt-3 block italic">{t('aboutGodNation.motto_text')}</span>
        </p>
        <span aria-hidden className="mt-1 block font-serif text-6xl leading-none text-gold-400/50">”</span>
      </blockquote>
      <div aria-hidden className="relative mt-1 flex items-center justify-center gap-2 text-gold-400/80">
        <span className="h-px w-16 bg-gold-400/50" />
        <span>❖</span>
        <span className="h-px w-16 bg-gold-400/50" />
      </div>
    </article>
  );
}
