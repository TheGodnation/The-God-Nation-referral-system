import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { usePublicSettings } from '../lib/usePublicSettings';
import {
  GraduationCapIcon,
  OpenBookIcon,
  HeartHandsIcon,
  UsersIcon,
  MediaPlayIcon,
  GlobeIcon,
  ChartIcon,
  DocumentIcon,
  SproutIcon,
  CompassIcon,
  ChatHeartIcon,
  WhatsAppIcon,
  TelegramIcon,
  MessengerIcon,
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  YouTubeIcon,
} from '../components/Icons';

type IconType = (p: { className?: string }) => JSX.Element;

// One brand-appropriate icon + background color per social platform.
const SOCIAL_ICONS: Record<string, { Icon: IconType; bg: string }> = {
  WhatsApp: { Icon: WhatsAppIcon, bg: '#25D366' },
  Telegram: { Icon: TelegramIcon, bg: '#26A5E4' },
  Messenger: { Icon: MessengerIcon, bg: '#0084FF' },
  Facebook: { Icon: FacebookIcon, bg: '#1877F2' },
  Instagram: { Icon: InstagramIcon, bg: '#E1306C' },
  TikTok: { Icon: TikTokIcon, bg: '#000000' },
  YouTube: { Icon: YouTubeIcon, bg: '#FF0000' },
};

const OFFERS: { n: number; Icon: IconType }[] = [
  { n: 1, Icon: OpenBookIcon },
  { n: 2, Icon: DocumentIcon },
  { n: 3, Icon: UsersIcon },
  { n: 4, Icon: ChatHeartIcon },
  { n: 5, Icon: ChartIcon },
  { n: 6, Icon: MediaPlayIcon },
];

const VALUES: { n: number; Icon: IconType }[] = [
  { n: 1, Icon: CompassIcon },
  { n: 2, Icon: SproutIcon },
  { n: 3, Icon: HeartHandsIcon },
  { n: 4, Icon: GlobeIcon },
];

function Label({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <p className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${light ? 'text-gold-400' : 'text-brand-600'}`}>
      <span aria-hidden className={`inline-block h-px w-6 ${light ? 'bg-gold-400' : 'bg-brand-600'}`} />
      {children}
    </p>
  );
}

function JoinButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link to="/member/join" className={`inline-flex items-center justify-center rounded-lg bg-gold-500 px-6 py-3 font-bold text-brand-950 shadow-lg shadow-black/10 hover:bg-gold-400 ${className}`}>
      {t('homePage.join')} <span aria-hidden className="ml-2">→</span>
    </Link>
  );
}

// The public front door ("/"): who we are, what we do, and how to join, in a
// few short sections. Referral attribution is silent — this page never shows
// who referred the visitor, and everyone sees the same page.
export function HomePage() {
  const { t } = useTranslation();
  const { facebookUrl, instagramUrl, tiktokUrl, youtubeUrl, whatsappContactUrl, telegramUrl, messengerUrl } = usePublicSettings();

  const socials = [
    { url: whatsappContactUrl, label: 'WhatsApp' },
    { url: telegramUrl, label: 'Telegram' },
    { url: messengerUrl, label: 'Messenger' },
    { url: facebookUrl, label: 'Facebook' },
    { url: instagramUrl, label: 'Instagram' },
    { url: tiktokUrl, label: 'TikTok' },
    { url: youtubeUrl, label: 'YouTube' },
  ].filter((s) => s.url);

  return (
    <PageShell homeNav>
      {/* Hero */}
      <section id="top" className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-4 py-16 text-white sm:py-24">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[30rem] w-[30rem] rounded-full bg-gold-400/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl" />
        {/* Our own logo (never a stand-in). */}
        <div className="absolute right-10 top-1/2 hidden -translate-y-1/2 overflow-hidden rounded-3xl bg-white p-3 shadow-2xl shadow-black/30 lg:block">
          <img src="/icons/icon-512.png" alt="The God Nation" className="h-72 w-72 object-contain" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <p className="text-xs font-bold uppercase tracking-widest text-gold-400">{t('homePage.eyebrow')}</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            {t('homePage.title_a')} <span className="text-gold-400">{t('homePage.title_b')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-brand-100 sm:text-lg">{t('homePage.support')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <JoinButton />
            <Link to="/member/login" className="inline-flex items-center justify-center rounded-lg border border-white/60 px-6 py-3 font-semibold text-white hover:bg-white/10">
              {t('homePage.sign_in')}
            </Link>
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-brand-100">
            <li className="flex items-center gap-2">
              <OpenBookIcon className="h-5 w-5 text-gold-400" /> {t('homePage.chip_faith')}
            </li>
            <li className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-gold-400" /> {t('homePage.chip_lead')}
            </li>
            <li className="flex items-center gap-2">
              <GlobeIcon className="h-5 w-5 text-gold-400" /> {t('homePage.chip_world')}
            </li>
          </ul>
        </div>
      </section>

      {/* What you can experience */}
      <section id="offer" className="scroll-mt-16 bg-brand-950 px-4 py-14 text-white sm:py-20">
        <div className="mx-auto max-w-6xl">
          <Label light>{t('homePage.offer_label')}</Label>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">{t('homePage.offer_title')}</h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {OFFERS.map(({ n, Icon }) => (
              <li key={n} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold-400/60 text-gold-400">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold">{t(`homePage.offer_${n}_t`)}</span>
                  <span className="mt-1 block text-sm text-brand-100">{t(`homePage.offer_${n}_b`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Community */}
      <section id="community" className="scroll-mt-16 bg-white px-4 py-14 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <Label>{t('homePage.community_label')}</Label>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-brand-900 sm:text-4xl">{t('homePage.community_title')}</h2>
            <p className="mt-4 text-slate-600">{t('homePage.community_body')}</p>
            <JoinButton className="mt-6" />
          </div>
          <ul className="grid grid-cols-2 gap-4">
            {VALUES.map(({ n, Icon }) => (
              <li key={n} className="rounded-2xl bg-brand-50 p-5">
                <Icon className="h-7 w-7 text-brand-700" />
                <span className="mt-3 block font-semibold text-brand-900">{t(`homePage.value_${n}_t`)}</span>
                <span className="block text-sm text-slate-600">{t(`homePage.value_${n}_b`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Learn. Grow. Lead. */}
      <section id="leadership" className="scroll-mt-16 bg-slate-50 px-4 py-14 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <Label>{t('homePage.leadership_label')}</Label>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-brand-900 sm:text-4xl">{t('homePage.leadership_title')}</h2>
            <p className="mt-4 text-slate-600">{t('homePage.leadership_body')}</p>
            <Link to="/member/join" className="mt-5 inline-block font-semibold text-brand-700 hover:underline">
              {t('homePage.leadership_link')} →
            </Link>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-900 to-brand-700 p-6 text-white">
            <GraduationCapIcon className="h-12 w-12 shrink-0 text-gold-400" />
            <p className="text-xl font-bold italic leading-snug">{t('homePage.leadership_tag')}</p>
          </div>
        </div>
      </section>

      {/* Global mission */}
      <section id="mission" className="scroll-mt-16 bg-gradient-to-br from-brand-900 to-brand-950 px-4 py-14 text-white sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <Label light>{t('homePage.mission_label')}</Label>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{t('homePage.mission_title')}</h2>
            <p className="mt-4 text-brand-100">{t('homePage.mission_body')}</p>
            <Link to="/member/join" className="mt-5 inline-block font-semibold text-gold-400 hover:underline">
              {t('homePage.mission_link')} →
            </Link>
          </div>
          <div className="flex items-center gap-4 lg:justify-end">
            <GlobeIcon className="h-16 w-16 shrink-0 text-gold-400/80" />
            <p className="text-lg font-semibold leading-snug text-gold-400">{t('homePage.mission_tag')}</p>
          </div>
        </div>
      </section>

      {/* Final invitation */}
      <section className="bg-white px-4 py-16 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-brand-900 sm:text-3xl">{t('homePage.final_title')}</h2>
          <p className="mt-3 text-slate-600">{t('homePage.final_body')}</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <JoinButton className="w-full max-w-xs" />
            <Link to="/member/login" className="text-sm font-semibold text-brand-700 hover:underline">
              {t('homePage.sign_in')}
            </Link>
          </div>
        </div>
      </section>

      {socials.length > 0 && (
        <section className="border-t border-slate-100 px-4 py-10 text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t('homePage.connect')}</h2>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {socials.map((s) => {
              const iconInfo = SOCIAL_ICONS[s.label];
              return (
                <a key={s.label} href={s.url!} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full border border-slate-200 py-2 pl-2 pr-5 text-sm font-medium text-brand-700 hover:bg-brand-50">
                  {iconInfo && (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: iconInfo.bg }}>
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
