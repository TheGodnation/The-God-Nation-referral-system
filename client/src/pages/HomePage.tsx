import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { usePublicSettings } from '../lib/usePublicSettings';
import {
  GraduationCapIcon,
  HeartHandsIcon,
  CompassIcon,
  FormIcon,
  ChatHeartIcon,
  WhatsAppIcon,
  TelegramIcon,
  MessengerIcon,
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  YouTubeIcon,
} from '../components/Icons';

// One brand-appropriate icon + background color per social platform, so the
// Connect section reads as a set of recognizable buttons rather than plain
// text links. Order matches how they're offered in the `socials` list below.
const SOCIAL_ICONS: Record<string, { Icon: (p: { className?: string }) => JSX.Element; bg: string }> = {
  WhatsApp: { Icon: WhatsAppIcon, bg: '#25D366' },
  Telegram: { Icon: TelegramIcon, bg: '#26A5E4' },
  Messenger: { Icon: MessengerIcon, bg: '#0084FF' },
  Facebook: { Icon: FacebookIcon, bg: '#1877F2' },
  Instagram: { Icon: InstagramIcon, bg: '#E1306C' },
  TikTok: { Icon: TikTokIcon, bg: '#000000' },
  YouTube: { Icon: YouTubeIcon, bg: '#FF0000' },
};

const HOW_ICONS = [CompassIcon, FormIcon, ChatHeartIcon];

// Section 15-17: one official homepage, two legitimate visitor pathways
// (Training first, then Discover & Grow). Referral attribution is silent —
// this page never shows who referred the visitor, and both pathways are
// offered identically regardless of how the visitor arrived.
export function HomePage() {
  const { t, i18n } = useTranslation();
  const {
    content,
    facebookUrl,
    instagramUrl,
    tiktokUrl,
    youtubeUrl,
    whatsappContactUrl,
    telegramUrl,
    messengerUrl,
    loaded,
  } = usePublicSettings();

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

  // Wait for the Admin's saved content to actually load before rendering
  // any content-dependent text. Without this, the page would render the
  // app's built-in default wording for an instant (since `content` starts
  // empty), then swap to the real saved text once the fetch resolves — a
  // visible "flash" from the old/default text to the new one.
  if (!loaded) {
    return (
      <PageShell>
        <div className="px-4 py-24 text-center text-slate-400">{t('join.loading')}</div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-950 to-brand-800 px-4 py-16 text-center text-white sm:py-24">
        {/* Purely decorative — a soft radiant glow behind the hero text, no
            photo needed. Hidden from assistive tech since it carries no
            content. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-gold-400/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl">
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
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <GraduationCapIcon className="h-7 w-7" />
          </div>
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
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-500">
                <HeartHandsIcon className="h-7 w-7" />
              </div>
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
            {howSteps.map((step, i) => {
              const StepIcon = HOW_ICONS[i];
              return (
                <div key={i} className="card text-center">
                  <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white">
                    <StepIcon className="h-5 w-5" />
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-[0.65rem] font-bold text-brand-950">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold text-brand-900">{step.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social footer */}
      {socials.length > 0 && (
        <section className="px-4 py-12 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {c('connectTitle') || t('home.connect_title')}
          </h2>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {socials.map((s) => {
              const iconInfo = SOCIAL_ICONS[s.label];
              return (
                <a
                  key={s.label}
                  href={s.url!}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-full border border-slate-200 py-2 pl-2 pr-5 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  {iconInfo && (
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                      style={{ background: iconInfo.bg }}
                    >
                      <iconInfo.Icon className="h-4 w-4" />
                    </span>
                  )}
                  {s.label}
                </a>
              );
            })}
          </div>
        </section>
      )}
    </PageShell>
  );
}
