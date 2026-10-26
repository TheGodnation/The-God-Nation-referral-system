import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';

// "Pay through a person" — the ministry's payment agents (staff), like a P2P
// trade: choose an agent who is online, chat in a payment order, pay, send the
// transaction ID and a screenshot, and the agent confirms. Shown inside the
// book's payment panel; nothing shows when the ministry has no agents.

export interface PayAgent {
  id: string;
  name: string;
  label: string | null;
  photoUrl: string | null;
  online: boolean;
  lastSeenAt: string | null;
  busy: boolean;
}

interface AgentsResponse {
  items: PayAgent[];
  activeOrder: { id: string; status: 'OPEN' | 'CLAIMED'; agentId: string } | null;
}

function useAgents(bookId: string, enabled: boolean) {
  const [data, setData] = useState<AgentsResponse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api
        .get<AgentsResponse>(`/api/member/pay/agents?bookId=${encodeURIComponent(bookId)}`)
        .then((r) => alive && setData(r))
        .catch(() => alive && setData({ items: [], activeOrder: null }));
    void load();
    // Who is online changes: look again now and then while the list is open.
    const timer = window.setInterval(load, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [bookId, enabled]);
  return data;
}

export function PresenceDot({ online }: { online: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={online ? t('payAgents.online') ?? '' : t('payAgents.offline') ?? ''}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`}
    />
  );
}

export function AgentPicker({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useAgents(bookId, true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data || data.items.length === 0) return null;

  async function choose(agentId: string) {
    setError(null);
    setBusyId(agentId);
    try {
      const res = await api.post<{ id: string }>('/api/member/pay/orders', { agentId, bookId });
      navigate(`/member/payment-orders/${res.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('payAgents.failed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-brand-100" data-testid="pay-agents">
      <p className="font-semibold text-brand-900">{t('payAgents.title')}</p>
      <p className="text-xs text-slate-600">{t('payAgents.how')}</p>
      {data.activeOrder && (
        <Link to={`/member/payment-orders/${data.activeOrder.id}`} className="block rounded-lg bg-brand-50 px-3 py-2 font-semibold text-brand-800 no-underline">
          💬 {t('payAgents.continue_chat')}
        </Link>
      )}
      <ul className="divide-y divide-slate-100">
        {data.items.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <Avatar name={a.name} photoUrl={a.photoUrl} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                <PresenceDot online={a.online} />
                <span className="truncate">{a.name}</span>
              </span>
              <span className="block truncate text-xs text-slate-500">
                {a.busy ? t('payAgents.busy') : a.online ? t('payAgents.online') : t('payAgents.offline')}
                {a.label ? ` · ${a.label}` : ''}
              </span>
            </span>
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={a.busy || busyId !== null} onClick={() => void choose(a.id)}>
              {t('payAgents.choose')}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** For a book whose payment is waiting: the way back to the chat with the agent. */
export function WaitingOrderLink({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const data = useAgents(bookId, true);
  if (!data?.activeOrder) return null;
  return (
    <Link to={`/member/payment-orders/${data.activeOrder.id}`} className="inline-block text-sm font-semibold text-brand-700 underline">
      💬 {t('payAgents.open_chat')}
    </Link>
  );
}
