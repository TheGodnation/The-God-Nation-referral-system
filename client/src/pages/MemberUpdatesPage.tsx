import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import { LiveBanner } from '../components/updates/LiveBanner';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

// The member Updates page, Facebook-style: a grey page with white posts
// that keep loading as you scroll. At the top: a live (when the admin is
// streaming) and the central admin's posts to everyone.
export function MemberUpdatesPage() {
  const { t } = useTranslation();
  const [friendsOnly, setFriendsOnly] = useState(false);
  return (
    <PageShell minimal>
      <div className="min-h-full bg-slate-100">
        <section className="mx-auto max-w-2xl pb-6 sm:px-4">
          <div className="flex items-center justify-between bg-white px-4 py-3 sm:mt-4 sm:rounded-xl sm:shadow-sm">
            <h1 className="text-2xl font-bold text-brand-900">{t('updates.title')}</h1>
            <NotificationBell />
          </div>
          <div className="mt-2 space-y-2 sm:mt-4 sm:space-y-4">
            <div className="space-y-2 px-4 empty:hidden sm:px-0">
              <LiveBanner />
              <HeadquartersPosts />
            </div>
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
