import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { usePublicSettings } from '../lib/usePublicSettings';

// Section 15-17: one official homepage, two legitimate visitor pathways
// (Training first, then Discover & Grow). Referral attribution is silent —
// this page never shows who referred the visitor, and both pathways are
// offered identically regardless of how the visitor arrived.
export function HomePage() {
  const { t } = useTranslation();
  const { content, facebookUrl, instagramUrl, tiktokUrl, youtubeUrl } = usePublicSettings();

  const socials = [
    { url: facebookUrl, label: 'Facebook' },
    { url: instagramUrl, label: 'Instagram' },
    { url: tiktokUrl, label: 'TikTok' },
    { url: youtubeUrl, label: 'YouTube' },
  ].filter((s) => s.url);

  return (
    <PageShell>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-950 to-brand-800 px-4 py-16 text-center text-white sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {content.homepageTitle || t('home.hero_title')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-medium text-gold-400 sm:text-lg">
            {content.homepageSubtitle || t('home.hero_tagline')}
          </p>
          <p className="mx-auto mt-4 max-w-xl text-base text-brand-100">{t('home.hero_support')}</p>
          <a
            href="#pathways"
            className="btn-primary mt-8 inline-flex w-full max-w-sm bg-gold-500 text-brand-950 hover:bg-gold-400 sm:w-auto"
          >
            {t('home.hero_cta')}
          </a>
        </div>
      </section>

      <div id="pathways">
        {/* Training pathway — appears first */}
        <section className="mx-auto max-w-3xl px-4 py-14 text-center">
          <h2 className="text-2xl font-bold text-brand-900 sm:text-3xl">
            {content.trainingTitle || t('home.training_heading')}
          </h2>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-600">
            {t('home.training_supporting')}
          </p>
          <p className="mt-4 text-slate-600">{content.trainingDescription || t('home.training_description')}</p>
          <Link to="/register?pathway=TRAINING" className="btn-primary mt-6 inline-flex w-full max-w-sm sm:w-auto">
            {content.trainingCta || t('home.training_cta')}
          </Link>
        </section>

        {/* Discover & Grow pathway */}
        <section className="bg-slate-50 px-4 py-14 text-center">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-brand-900 sm:text-3xl">
              {content.discoverTitle || t('home.discover_heading')}
            </h2>
            <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-600">
              {t('home.discover_supporting')}
            </p>
            <p className="mt-4 text-slate-600">{content.discoverDescription || t('home.discover_description')}</p>
            <Link
              to="/register?pathway=DISCOVER_GROW"
              className="btn-secondary mt-6 inline-flex w-full max-w-sm sm:w-auto"
            >
              {content.discoverCta || t('home.discover_cta')}
            </Link>
          </div>
        </section>
      </div>

      {/* Short vision */}
      <section className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-brand-900">{t('home.vision_title')}</h2>
        <p className="mt-3 text-slate-600">{content.vision || t('home.vision_body')}</p>
      </section>

      {/* Very short How It Works */}
      <section className="bg-slate-50 px-4 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold text-brand-900">{t('home.how_title')}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {(['how_1', 'how_2', 'how_3'] as const).map((key, i) => (
              <div key={key} className="card text-center">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="font-semibold text-brand-900">{t(`home.${key}_title`)}</h3>
                <p className="mt-2 text-sm text-slate-600">{t(`home.${key}_body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social footer */}
      {socials.length > 0 && (
        <section className="px-4 py-12 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {t('home.connect_title')}
          </h2>
          <div className="mt-4 flex flex-wrap justify-center gap-4">
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.url!}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-200 px-5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                {s.label}
              </a>
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
