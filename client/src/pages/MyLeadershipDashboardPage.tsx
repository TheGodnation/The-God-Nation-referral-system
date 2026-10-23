import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { LeadershipDashboardBody } from '../components/leader/LeadershipDashboardBody';
import { useAuth } from '../lib/AuthContext';

// Section 8/9: "My Leadership Dashboard" — every Leader tool (referral
// link + stats, Your Referrals, Follow-Ups, Exam Results, Leadership
// Collaboration, Organizational Recommendations, …) living right inside
// the Member app, for a Member who has been assigned/bridged as a Leader.
// Reached only once sign-in has silently established a paired Leader (sid)
// session behind the ordinary Member (msid) one — see lib/auth.ts's
// autoPairLeaderSession. Deliberately named and routed apart from the
// pre-existing, unrelated public "Leadership Directory" (/member/leadership).
export function MyLeadershipDashboardPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">{t('common.loading')}</div>;
  }
  if (user?.role !== 'LEADER') {
    return <Navigate to="/member/me" replace />;
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('leader.my_dashboard_title')}</h1>
          <NotificationBell />
        </div>

        <LeadershipDashboardBody />

        <MemberNav />
      </section>
    </PageShell>
  );
}
