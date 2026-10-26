import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { Avatar } from '../components/Avatar';
import { PresenceDot } from '../components/learn/PayWithAgent';
import { api, ApiError } from '../lib/api';

// The payment agent's desk: the orders waiting for them (people who want to
// pay for a book, or say they have paid), and the latest finished ones.

interface DeskOrder {
  id: string;
  status: 'OPEN' | 'CLAIMED' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  amount: number;
  bookNumber: number | null;
  bookCount: number;
  buyerName: string;
  buyerPhotoUrl: string | null;
  buyerOnline: boolean;
  updatedAt: string;
}

interface Desk {
  dailyLimit: number;
  confirmedToday: number;
  waiting: DeskOrder[];
  recent: DeskOrder[];
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

function Row({ o }: { o: DeskOrder }) {
  const { t } = useTranslation();
  return (
    <li>
      <Link to={`/member/payment-orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 no-underline hover:bg-slate-50">
        <Avatar name={o.buyerName} photoUrl={o.buyerPhotoUrl} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-semibold text-slate-900">
            <PresenceDot online={o.buyerOnline} />
            <span className="truncate">{o.buyerName}</span>
          </span>
          <span className="block truncate text-sm text-slate-500">
            {o.bookCount > 1 ? t('payAgents.books_line', { count: o.bookCount }) : t('payAgents.book_line', { number: o.bookNumber ?? '' })} · {fcfa(o.amount)}
          </span>
        </span>
        <span className={`shrink-0 text-xs font-semibold ${o.status === 'CLAIMED' ? 'text-amber-700' : o.status === 'CONFIRMED' ? 'text-green-700' : 'text-slate-500'}`}>
          {o.status === 'CLAIMED' ? t('payAgents.desk_check') : t(`payAgents.status_${o.status.toLowerCase()}`)}
        </span>
      </Link>
    </li>
  );
}

export function MemberPaymentDeskPage() {
  const { t } = useTranslation();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<Desk>('/api/member/pay/desk')
        .then((r) => alive && setDesk(r))
        .catch((err) => alive && setError(err instanceof ApiError && err.status === 403 ? t('payAgents.not_agent') : t('payAgents.failed')));
    void load();
    const timer = window.setInterval(() => document.visibilityState !== 'hidden' && void load(), 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [t]);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link to="/member/chats" aria-label={t('payAgents.back') ?? ''} className="text-2xl text-brand-700 no-underline">
            ‹
          </Link>
          <h1 className="text-2xl font-bold text-brand-900">{t('payAgents.desk_title')}</h1>
        </div>
        {error && <p className="card text-slate-600">{error}</p>}
        {!error && !desk && <p className="text-sm text-slate-400">{t('memberDashboard.loading')}</p>}
        {desk && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{t('payAgents.desk_today', { done: desk.confirmedToday, limit: desk.dailyLimit })}</p>
            <section className="card p-0">
              <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('payAgents.desk_waiting')}</h2>
              {desk.waiting.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">{t('payAgents.desk_none')}</p> : <ul className="divide-y divide-slate-100">{desk.waiting.map((o) => <Row key={o.id} o={o} />)}</ul>}
            </section>
            {desk.recent.length > 0 && (
              <section className="card p-0">
                <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('payAgents.desk_recent')}</h2>
                <ul className="divide-y divide-slate-100">{desk.recent.map((o) => <Row key={o.id} o={o} />)}</ul>
              </section>
            )}
          </div>
        )}
      </section>
    </PageShell>
  );
}
