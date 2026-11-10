import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';
import { useMyLeader } from '../../lib/useMyLeader';

/** On a person's Home page: who from the Leadership Team has been assigned to follow them up, and a way to write to them. */
export function MyLeaderCard() {
  const { t } = useTranslation();
  const leader = useMyLeader();
  if (!leader) return null;
  return (
    <section className="mx-4 rounded-xl border-l-4 border-gold-400 bg-white p-4 shadow-sm sm:mx-0" data-testid="my-leader-card" aria-label={t('myLeader.title') ?? ''}>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t('myLeader.title')}</p>
      <div className="mt-2 flex items-center gap-3">
        <Avatar name={leader.name} photoUrl={leader.photoUrl} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{leader.name}</p>
          <p className="text-sm text-slate-600">{t('myLeader.from_team')}</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-700">{t('myLeader.help')}</p>
      <Link to={`/member/people/${leader.personId}`} className="btn-primary mt-3 inline-flex w-full justify-center" data-testid="my-leader-message">
        {t('myLeader.message')}
      </Link>
    </section>
  );
}

/** A small label for "your leader" beside a name in the private chat. */
export function YourLeaderBadge({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-900 ${className}`} data-testid="your-leader-badge">
      {t('myLeader.badge')}
    </span>
  );
}
