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
  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('updates.title')}</h1>
          <NotificationBell />
        </div>
        <MemberNav />
        <div className="space-y-6">
          <LiveBanner />
          <HeadquartersPosts />
          <UpdatesFeed />
        </div>
      </section>
    </PageShell>
  );
}
