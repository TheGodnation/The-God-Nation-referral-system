import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// The member's main sections. Starts with Home and Updates; more sections
// (Learn, Profile) join here as they are built.
export function MemberNav() {
  const { t } = useTranslation();
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium ${isActive ? 'bg-brand-700 text-white' : 'bg-white text-brand-800 ring-1 ring-slate-200'}`;
  return (
    <nav aria-label={t('memberNav.label') ?? ''} className="mb-6 flex gap-2">
      <NavLink to="/member/dashboard" className={item} end>
        {t('memberNav.home')}
      </NavLink>
      <NavLink to="/member/updates" className={item}>
        {t('memberNav.updates')}
      </NavLink>
      <NavLink to="/member/people" className={item}>
        {t('memberNav.people')}
      </NavLink>
      <NavLink to="/member/learn" className={item}>
        {t('memberNav.learn')}
      </NavLink>
    </nav>
  );
}
