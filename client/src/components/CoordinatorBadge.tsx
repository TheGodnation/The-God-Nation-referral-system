import { useTranslation } from 'react-i18next';

// "National Coordinator" next to the central admin's name (posts, chats,
// comments, prayer requests and the profile page).
export function CoordinatorBadge({ badge, className = '' }: { badge?: string | null; className?: string }) {
  const { t } = useTranslation();
  if (badge !== 'NATIONAL_COORDINATOR') return null;
  return (
    <span className={`ml-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-brand-50 px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-brand-800 ring-1 ring-brand-100 ${className}`}>
      ★ {t('badges.national_coordinator')}
    </span>
  );
}
