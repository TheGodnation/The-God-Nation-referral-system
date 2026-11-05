import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { HomeAboutTabs } from '../components/member/HomeAboutTabs';
import { resolveWallpaperStyle } from '../lib/wallpaper';
import { usePublicSettings } from '../lib/usePublicSettings';
import { SOCIAL_ICONS, configuredSocials } from '../components/socialPlatforms';
import { MottoCard } from '../components/MottoCard';

// "About the God Nation": the academy's own words — who we are, our calling,
// our vision in action (the mission is blended into it), and our motto, which
// stands where the mission used to be — as written by the central admin
// (English and French), followed by ways to take part. Same blue and the same
// background as the Home page.
const SECTIONS = [
  { id: 'who', paragraphs: 3 },
  { id: 'calling', paragraphs: 3 },
  { id: 'action', paragraphs: 5 },
] as const;

export function MemberAboutPage() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const { homeWallpaper } = settings;
  const socials = configuredSocials(settings);
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
                  <p key={i} className="text-[15px] leading-relaxed text-slate-800">
                    {t(`aboutGodNation.${s.id}_p${i + 1}`)}
                  </p>
                ))}
              </article>
            ))}

            <MottoCard />

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
                  <Link to="/member/represent" className="font-medium text-brand-700 underline">{t('aboutGodNation.join_represent')}</Link>
                </li>
              </ul>
            </article>

            {socials.length > 0 && (
              <article className="card space-y-3 border-l-4 border-brand-500" aria-labelledby="about-social" data-testid="about-social">
                <h2 id="about-social" className="font-semibold text-brand-900">
                  {t('aboutGodNation.social_title')}
                </h2>
                <p className="text-[15px] leading-relaxed text-slate-800">{t('aboutGodNation.social_intro')}</p>
                <ul className="space-y-2">
                  {socials.map((s) => {
                    const icon = SOCIAL_ICONS[s.icon];
                    return (
                      <li key={s.key}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-medium text-brand-800 no-underline hover:bg-brand-50"
                        >
                          {icon && (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: icon.bg }}>
                              <icon.Icon className="h-5 w-5" />
                            </span>
                          )}
                          <span>{t(`aboutGodNation.social_${s.key}`)}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </article>
            )}
          </div>
          <MemberNav />
        </section>
      </div>
    </PageShell>
  );
}
