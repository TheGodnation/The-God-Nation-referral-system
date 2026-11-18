import { useTranslation } from 'react-i18next';

// The three things a member gets from notifications, as small badges. Shared by every "turn on notifications" prompt so
// they all give the same, clear reason to say yes.
export function NotificationBenefits({ className = 'mt-2' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <ul className={`${className} flex flex-wrap gap-1.5`} data-testid="notify-benefits">
      {(['events', 'teachings', 'messages'] as const).map((k) => (
        <li key={k} className="flex items-center gap-1 rounded-full border border-brand-100 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-900">
          <span aria-hidden="true">{k === 'events' ? '📅' : k === 'teachings' ? '📖' : '💬'}</span>
          {t(`notifications.benefit_${k}`)}
        </li>
      ))}
    </ul>
  );
}
