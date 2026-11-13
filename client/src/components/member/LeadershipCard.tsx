import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/AuthContext';
import { useMemberAuth } from '../../lib/MemberAuthContext';

// The way into "My Leadership Dashboard", on the Chats page beside Events.
// Everyone sees it: leaders open their tools; everyone else is shown what it
// takes to become a leader (see LeadershipLockedPage), which draws them to
// the Leadership Academy. The central admin's tools live on their own profile.
export function LeadershipCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { member } = useMemberAuth();
  const isLeader = user?.role === 'LEADER';
  const isAdmin = Boolean(member?.isCentralAdmin);
  const to = isAdmin ? '/member/me' : '/member/leadership-dashboard';
  const sub = isAdmin ? t('leadershipCard.sub_admin') : isLeader ? t('leadershipCard.sub_leader') : t('leadershipCard.sub_member');

  return (
    <Link to={to} className="card mb-4 flex items-center gap-3 no-underline" data-testid="leadership-card">
      <span aria-hidden className="text-2xl">🧭</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-brand-900">{t('leadershipCard.title')}</span>
        <span className="block truncate text-sm text-slate-600">{sub}</span>
      </span>
      {!isLeader && !isAdmin && <span aria-hidden className="text-lg">🔒</span>}
      <span aria-hidden className="text-brand-700">›</span>
    </Link>
  );
}
