import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { EnableNotificationsBanner } from '../components/member/EnableNotificationsBanner';
import { MemberPhotoSlider } from '../components/member/MemberPhotoSlider';
import { HomeAboutTabs } from '../components/member/HomeAboutTabs';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import { LiveBanner } from '../components/updates/LiveBanner';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';
import { resolveWallpaperStyle } from '../lib/wallpaper';
import { usePublicSettings } from '../lib/usePublicSettings';

// The member Home page (formerly "Updates"), Facebook-style: a grey page
// with white cards that keep loading as you scroll. At the top: the member
// photo slider for discovering other members, a live banner (when the admin
// is streaming), and the central admin's posts to everyone.
export function MemberUpdatesPage() {
  const { t } = useTranslation();
  const { homeWallpaper } = usePublicSettings();
  const [friendsOnly, setFriendsOnly] = useState(false);
  return (
    <PageShell minimal>
      <div className="min-h-full" style={resolveWallpaperStyle(homeWallpaper?.preset ?? null, homeWallpaper?.imageUrl ?? null)}>
        <section className="mx-auto max-w-2xl pb-6 sm:px-4">
          <h1 className="sr-only">{t('memberHome.title')}</h1>
          <div className="space-y-2 sm:mt-4 sm:space-y-4">
            <HomeAboutTabs active="home" trailing={<NotificationBell />} />
            <div className="px-4 empty:hidden sm:px-0">
              <EnableNotificationsBanner className="" />
            </div>
            <MemberPhotoSlider />
            <div className="px-4 empty:hidden sm:px-0">
              <LiveBanner />
            </div>
            <HeadquartersPosts variant="feed" />
            <div className="flex gap-2 px-4 sm:px-0" role="tablist" aria-label={t('updates.view_label') ?? ''}>
              <button
                type="button"
                role="tab"
                aria-selected={!friendsOnly}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${!friendsOnly ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}
                onClick={() => setFriendsOnly(false)}
              >
                {t('updates.view_everyone')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={friendsOnly}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${friendsOnly ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}
                onClick={() => setFriendsOnly(true)}
              >
                {t('updates.view_friends')}
              </button>
            </div>
            <UpdatesFeed friendsOnly={friendsOnly} linkAuthors wall />
          </div>
          <MemberNav />
        </section>
      </div>
    </PageShell>
  );
}
