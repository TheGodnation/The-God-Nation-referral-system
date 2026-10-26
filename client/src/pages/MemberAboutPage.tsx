import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { HomeAboutTabs } from '../components/member/HomeAboutTabs';
import { RichText } from '../lib/richText';
import { resolveWallpaperStyle } from '../lib/wallpaper';
import { usePublicSettings } from '../lib/usePublicSettings';

// "About the God Nation": who we are, what we are called to do, and how a
// member can take part. It leads with the work — assembling the church and
// training Christians so they join the team and carry the Gospel through
// modern media — and only then speaks of the digital and spiritual home.
// The ministry's vision, mission and purpose are the ones the central admin
// keeps in the settings (the same boxes shown on the Updates banner); until
// they are set, the wording from the ministry's own document is shown, so this
// page is never empty. Same blue and same background as the Home page.
export function MemberAboutPage() {
  const { t, i18n } = useTranslation();
  const { content, loaded, homeWallpaper } = usePublicSettings();
  const lang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const setting = (key: string) => (content[`${key}${lang}`] || content[`${key}En`] || '').trim();
  const slogan = setting('appSlogan');

  const statements = [
    { key: 'appVision', icon: '👁', title: t('updates.vision'), fallback: t('aboutGodNation.vision_default') },
    { key: 'appMission', icon: '📌', title: t('updates.mission'), fallback: t('aboutGodNation.mission_default') },
    { key: 'appPurpose', icon: '🎯', title: t('updates.purpose'), fallback: t('aboutGodNation.purpose_default') },
  ];

  const finds = ['equipped', 'sent', 'grow', 'community', 'discover'] as const;
  const steps = ['learners', 'disciples', 'leaders', 'multipliers'] as const;
  const section = 'card space-y-2 border-l-4 border-brand-500';

  return (
    <PageShell minimal>
      <div className="min-h-full" style={resolveWallpaperStyle(homeWallpaper?.preset ?? null, homeWallpaper?.imageUrl ?? null)}>
        <section className="mx-auto max-w-2xl space-y-3 pb-6 sm:px-4">
          <div className="flex items-center justify-between bg-white px-4 py-3 sm:mt-4 sm:rounded-xl sm:shadow-sm">
            <h1 className="text-2xl font-bold text-brand-900">{t('memberHome.title')}</h1>
            <NotificationBell />
          </div>
          <HomeAboutTabs active="about" />

          <div className="space-y-3 px-4 sm:px-0">
            <header className="rounded-xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-5 text-white shadow-sm">
              <div className="flex items-center gap-3">
                <img src="/icons/icon-192.png" alt="" className="h-14 w-14 shrink-0 rounded-full bg-white object-contain p-0.5" />
                <div>
                  <h2 className="text-xl font-bold leading-tight">{t('aboutGodNation.title')}</h2>
                  <p className="text-sm text-brand-100">{slogan || t('aboutGodNation.subtitle')}</p>
                </div>
              </div>
            </header>

            <article className={section}>
              <h2 className="font-semibold text-brand-900">{t('aboutGodNation.who_title')}</h2>
              <p className="text-[15px] leading-relaxed text-slate-800">{t('aboutGodNation.who_body')}</p>
            </article>

            <div className="space-y-2">
              {/* Shown once the saved settings have arrived, so default wording never flashes before the admin's own. */}
              {loaded &&
                statements.map((s) => (
                  <article key={s.key} className="rounded-xl border-l-4 border-brand-400 bg-white p-4 shadow-sm">
                    <h2 className="text-sm font-bold text-brand-900">
                      {s.icon} {s.title}
                    </h2>
                    <RichText className="mt-1 text-slate-700" text={setting(s.key) || s.fallback} headings />
                  </article>
                ))}
            </div>

            <article className={`${section} space-y-3`}>
              <h2 className="font-semibold text-brand-900">{t('aboutGodNation.path_title')}</h2>
              <ol className="flex flex-wrap items-center gap-2 text-sm font-semibold text-brand-800">
                {steps.map((k, i) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="rounded-full bg-brand-50 px-3 py-1">{t(`aboutGodNation.step_${k}`)}</span>
                    {i < steps.length - 1 && <span aria-hidden className="text-brand-300">→</span>}
                  </li>
                ))}
              </ol>
              <p className="text-slate-700">{t('aboutGodNation.path_body')}</p>
              <p className="text-sm text-slate-500">{t('aboutGodNation.not_denomination')}</p>
            </article>

            <article className={section}>
              <h2 className="font-semibold text-brand-900">{t('aboutGodNation.finds_title')}</h2>
              <ul className="space-y-2">
                {finds.map((k) => (
                  <li key={k} className="text-slate-700">
                    <strong className="text-brand-900">{t(`aboutGodNation.find_${k}_title`)}.</strong> {t(`aboutGodNation.find_${k}_body`)}
                  </li>
                ))}
              </ul>
            </article>

            <article className="card space-y-1 bg-brand-50/60">
              <h2 className="text-sm font-semibold text-brand-900">{t('aboutGodNation.home_title')}</h2>
              <p className="text-sm text-slate-700">{t('aboutGodNation.blessed_body')}</p>
            </article>

            <article className={section}>
              <h2 className="font-semibold text-brand-900">{t('aboutGodNation.calling_title')}</h2>
              <p className="text-slate-700">{t('aboutGodNation.calling_body')}</p>
              <blockquote className="border-l-4 border-brand-300 pl-3 text-sm italic text-slate-600">
                {t('aboutGodNation.verse_text')} <span className="font-medium not-italic">— {t('aboutGodNation.verse_ref')}</span>
              </blockquote>
            </article>

            <article className={section}>
              <h2 className="font-semibold text-brand-900">{t('aboutGodNation.join_title')}</h2>
              <ul className="space-y-1.5 text-slate-700">
                <li>
                  <Link to="/member/learn" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_learn')}</Link>
                </li>
                <li>
                  <Link to="/member/chats" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_assembly')}</Link>
                </li>
                <li>
                  <Link to="/member/referrals" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_invite')}</Link>
                </li>
                <li>
                  <Link to="/member/leadership" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_leaders')}</Link>
                </li>
                <li>
                  <Link to="/member/leadership" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_represent')}</Link>
                </li>
              </ul>
            </article>

            <p className="py-2 text-center text-sm font-bold tracking-wide text-brand-800">{t('aboutGodNation.closing')}</p>
          </div>
          <MemberNav />
        </section>
      </div>
    </PageShell>
  );
}
