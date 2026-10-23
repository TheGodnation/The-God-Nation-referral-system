import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { PrayerRequests } from '../components/PrayerRequests';

// A dedicated page for Prayer Requests (Phase 2), reached via a link from
// the member Home page — the bottom nav already has its full five tabs
// (Chats · Home · Learn · People · Me), same reasoning as
// MemberLeadershipPage/MemberReferralsPage being secondary pages too.
export function MemberPrayerPage() {
  const { t } = useTranslation();
  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-end">
          <Link to="/member/updates" className="text-sm text-brand-700 underline">
            {t('prayerRequests.back')}
          </Link>
        </div>
        <PrayerRequests />
        <MemberNav />
      </section>
    </PageShell>
  );
}
