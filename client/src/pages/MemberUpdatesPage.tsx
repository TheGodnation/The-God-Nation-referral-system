import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import { LiveBanner } from '../components/updates/LiveBanner';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

// The member Updates page: a live (when the admin is streaming), then the
// central admin's posts to everyone, then the community feed.
export function MemberUpdatesPage() {
  const { t } = useTranslation();
  const [friendsOnly, setFriendsOnly] = useState(false);
  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('updates.title')}</h1>
          <NotificationBell />
        </div>
        <div className="space-y-6">
          <LiveBanner />
          <HeadquartersPosts />
          <div className="flex gap-2" role="tablist" aria-label={t('updates.view_label') ?? ''}>
            <button type="button" role="tab" aria-selected={!friendsOnly} className={!friendsOnly ? 'btn-primary' : 'btn-secondary'} onClick={() => setFriendsOnly(false)}>
              {t('updates.view_everyone')}
            </button>
            <button type="button" role="tab" aria-selected={friendsOnly} className={friendsOnly ? 'btn-primary' : 'btn-secondary'} onClick={() => setFriendsOnly(true)}>
              {t('updates.view_friends')}
            </button>
          </div>
          <UpdatesFeed friendsOnly={friendsOnly} linkAuthors />
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
