import { useTranslation } from 'react-i18next';

/** A small label for "your leader" beside a name in the private chat. */
export function YourLeaderBadge({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-900 ${className}`} data-testid="your-leader-badge">
      {t('myLeader.badge')}
    </span>
  );
}
