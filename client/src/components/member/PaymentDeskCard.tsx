import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

// For payment agents only: the way into the payment desk, with how many
// orders are waiting. Nothing shows for anyone else.
export function PaymentDeskCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<{ isAgent: boolean; waiting: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<{ isAgent: boolean; waiting: number }>('/api/member/pay/me')
        .then((r) => alive && setState(r))
        .catch(() => alive && setState(null));
    void load();
    // Staying online is part of the job: this also tells people the agent is there.
    const timer = window.setInterval(() => document.visibilityState !== 'hidden' && void load(), 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!state?.isAgent) return null;
  return (
    <Link to="/member/payment-desk" className="card mb-4 flex items-center gap-3 border-gold-400 no-underline">
      <span aria-hidden className="text-2xl">💳</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-brand-900">{t('payAgents.desk_title')}</span>
        <span className="block truncate text-sm text-slate-600">{state.waiting > 0 ? t('payAgents.desk_card_waiting', { count: state.waiting }) : t('payAgents.desk_card_none')}</span>
      </span>
      {state.waiting > 0 && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{state.waiting}</span>}
      <span aria-hidden className="text-brand-700">›</span>
    </Link>
  );
}
