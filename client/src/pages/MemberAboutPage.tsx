import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { HomeAboutTabs } from '../components/member/HomeAboutTabs';
import { resolveWallpaperStyle } from '../lib/wallpaper';
import { usePublicSettings } from '../lib/usePublicSettings';

// "About the God Nation": the academy's own words — who we are, our calling,
// our vision in action and our mission — as written by the central admin
// (English and French), followed by ways to take part. Same blue and the same
// background as the Home page.
const SECTIONS = [
  { id: 'who', paragraphs: 3 },
  { id: 'calling', paragraphs: 3 },
  { id: 'action', paragraphs: 4 },
  { id: 'mission', paragraphs: 3 },
] as const;

export function MemberAboutPage() {
  const { t } = useTranslation();
  const { homeWallpaper } = usePublicSettings();
  const section = 'card space-y-3 border-l-4 border-brand-500';

  return (
    <PageShell minimal>
      <div className="min-h-full" style={resolveWallpaperStyle(homeWallpaper?.preset ?? null, homeWallpaper?.imageUrl ?? null)}>
        <section className="mx-auto max-w-2xl space-y-3 pb-6 sm:px-4">
          <div className="flex items-center justify-between border-t-4 border-gold-400 bg-white px-4 py-3 sm:mt-4 sm:rounded-xl sm:shadow-sm">
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
                  <p className="text-sm text-brand-100">{t('aboutGodNation.subtitle')}</p>
                </div>
              </div>
            </header>

            {SECTIONS.map((s) => (
              <article key={s.id} className={section} aria-labelledby={`about-${s.id}`}>
                <h2 id={`about-${s.id}`} className="font-semibold text-brand-900">
                  {t(`aboutGodNation.${s.id}_title`)}
                </h2>
                {Array.from({ length: s.paragraphs }, (_, i) => (
                  <p
                    key={i}
                    // The closing line of the mission is the one to remember.
                    className={`text-[15px] leading-relaxed ${s.id === 'mission' && i === s.paragraphs - 1 ? 'font-semibold text-brand-900' : 'text-slate-800'}`}
                  >
                    {t(`aboutGodNation.${s.id}_p${i + 1}`)}
                  </p>
                ))}
              </article>
            ))}

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
                  <Link to="/member/prayer" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_pray')}</Link>
                </li>
                <li>
                  <Link to="/member/leadership" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_leaders')}</Link>
                </li>
                <li>
                  <Link to="/member/leadership" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_represent')}</Link>
                </li>
              </ul>
            </article>
          </div>
          <MemberNav />
        </section>
      </div>
    </PageShell>
  );
}
