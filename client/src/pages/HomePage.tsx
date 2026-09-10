import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { usePublicSettings } from '../lib/usePublicSettings';

// Section 15-17: one official homepage, two legitimate visitor pathways
// (Training first, then Discover & Grow). Referral attribution is silent —
// this page never shows who referred the visitor, and both pathways are
// offered identically regardless of how the visitor arrived.
export function HomePage() {
  const { t, i18n } = useTranslation();
  const { content, facebookUrl, instagramUrl, tiktokUrl, youtubeUrl, whatsappContactUrl, telegramUrl, messengerUrl } =
    usePublicSettings();

  // Every Admin-editable content key is stored as a bilingual pair
  // (e.g. homepageTitleEn / homepageTitleFr) so an edit in one language can
  // never silently override what the other language's visitors see. `c()`
  // reads the pair for the visitor's current language, falling back to the
  // app's own built-in (fully translated) default text when nothing was
  // set in Admin for that language.
  const lang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const c = (key: string): string | undefined => content[`${key}${lang}`] || undefined;

  const socials = [
    { url: whatsappContactUrl, label: 'WhatsApp' },
    { url: telegramUrl, label: 'Telegram' },
    { url: messengerUrl, label: 'Messenger' },
    { url: facebookUrl, label: 'Facebook' },
    { url: instagramUrl, label: 'Instagram' },
    { url: tiktokUrl, label: 'TikTok' },
    { url: youtubeUrl, label: 'YouTube' },
  ].filter((s) => s.url);

  const howSteps = [
    { title: c('how1Title') || t('home.how_1_title'), body: c('how1Body') || t('home.how_1_body') },
    { title: c('how2Title') || t('home.how_2_title'), body: c('how2Body') || t('home.how_2_body') },
    { title: c('how3Title') || t('home.how_3_title'), body: c('how3Body') || t('home.how_3_body') },
  ];

  return (
    <PageShell>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-950 to-brand-800 px-4 py-16 text-center text-white sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {c('homepageTitle') || t('home.hero_title')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-medium text-gold-400 sm:text-lg">
            {c('homepageSubtitle') || t('home.hero_tagline')}
          </p>
          <p className="mx-auto mt-4 max-w-xl text-base text-brand-100">
            {c('heroSupport') || t('home.hero_support')}
          </p>
          <a
            href="#pathways"
            className="btn-primary mt-8 inline-flex w-full max-w-sm bg-gold-500 text-brand-950 hover:bg-gold-400 sm:w-auto"
          >
            {c('heroCta') || t('home.hero_cta')}
          </a>
        </div>
      </section>

      <div id="pathways">
        {/* Training pathway — appears first */}
        <section className="mx-auto max-w-3xl px-4 py-14 text-center">
          <h2 className="text-2xl font-bold text-brand-900 sm:text-3xl">
            {c('trainingTitle') || t('home.training_heading')}
          </h2>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-600">
            {c('trainingSupporting') || t('home.training_supporting')}
          </p>
          <p className="mt-4 text-slate-600">{c('trainingDescription') || t('home.training_description')}</p>
          {c('trainingExplanation') && <p className="mt-3 text-sm text-slate-500">{c('trainingExplanation')}</p>}
          <Link to="/register?pathway=TRAINING" className="btn-primary mt-6 inline-flex w-full max-w-sm sm:w-auto">
            {c('trainingCta') || t('home.training_cta')}
          </Link>
        </section>

        {/* Discover & Grow pathway — hidden until an Admin actually fills in
            its title. Unlike other sections, this one has no content yet,
            so it must not show placeholder/default text as if it were
            real; presence of a real title is what turns it on. */}
        {c('discoverTitle') && (
          <section className="bg-slate-50 px-4 py-14 text-center">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold text-brand-900 sm:text-3xl">{c('discoverTitle')}</h2>
              <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-600">
                {c('discoverSupporting') || t('home.discover_supporting')}
              </p>
              <p className="mt-4 text-slate-600">{c('discoverDescription') || t('home.discover_description')}</p>
              <Link
                to="/register?pathway=DISCOVER_GROW"
                className="btn-secondary mt-6 inline-flex w-full max-w-sm sm:w-auto"
              >
                {c('discoverCta') || t('home.discover_cta')}
              </Link>
            </div>
          </section>
        )}
      </div>

      {/* Short vision */}
      <section className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-brand-900">{c('visionTitle') || t('home.vision_title')}</h2>
        <p className="mt-3 text-slate-600">{c('vision') || t('home.vision_body')}</p>
      </section>

      {/* Very short How It Works */}
      <section className="bg-slate-50 px-4 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold text-brand-900">{c('howTitle') || t('home.how_title')}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {howSteps.map((step, i) => (
              <div key={i} className="card text-center">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="font-semibold text-brand-900">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social footer */}
      {socials.length > 0 && (
        <section className="px-4 py-12 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {c('connectTitle') || t('home.connect_title')}
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
