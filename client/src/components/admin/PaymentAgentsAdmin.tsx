import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

// Central admin: payment agents — the ministry's staff who receive book
// payments (the money goes into the ministry's account, never theirs) and
// confirm them — and every payment order with its chat and screenshots.

interface AgentRow {
  id: string;
  personId: string;
  name: string;
  whatsappNumber: string;
  active: boolean;
  label: string | null;
  dailyLimit: number;
  instructions: string | null;
  online: boolean;
  confirmedToday: number;
  confirmedTotal: number;
  waiting: number;
}

interface OrderRow {
  id: string;
  status: string;
  amount: number;
  bookNumber: number | null;
  bookCount?: number;
  buyerName: string;
  agentName: string;
  reference: string | null;
  proofs: number;
  createdAt: string;
}

interface Thread {
  id: string;
  status: string;
  messages: { id: string; mine: boolean; senderName: string; body: string; hasProof: boolean; createdAt: string }[];
}

function Proof({ orderId, messageId }: { orderId: string; messageId: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={t('payAgents.screenshot') ?? ''} className="mt-1 max-h-48 rounded" />
    </a>
  ) : (
    <button
      type="button"
      className="text-brand-700 underline"
      onClick={() => api.get<{ url: string }>(`/api/admin/payment-orders/${orderId}/messages/${messageId}/proof-url`).then((r) => setUrl(r.url)).catch(() => {})}
    >
      📷 {t('payAgents.admin_show_screenshot')}
    </button>
  );
}

function AgentCard({ a, onChanged }: { a: AgentRow; onChanged: () => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(a.label ?? '');
  const [limit, setLimit] = useState(String(a.dailyLimit));
  const [instructions, setInstructions] = useState(a.instructions ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/api/admin/payment-agents/${a.id}`, body);
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('library.action_failed'));
    }
  }

  return (
    <li className="space-y-2 py-3" data-testid={`agent-${a.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">
          <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${a.online ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden />
          {a.name} <span className="text-xs font-normal text-slate-500">{a.whatsappNumber}</span>
        </p>
        <button type="button" className={a.active ? 'btn-secondary px-3 py-1 text-sm' : 'btn-primary px-3 py-1 text-sm'} onClick={() => void patch({ active: !a.active })}>
          {a.active ? t('payAgents.admin_switch_off') : t('payAgents.admin_switch_on')}
        </button>
      </div>
      <p className="text-xs text-slate-500">{t('payAgents.admin_stats', { today: a.confirmedToday, total: a.confirmedTotal, waiting: a.waiting })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" aria-label={t('payAgents.admin_label') ?? ''} placeholder={t('payAgents.admin_label') ?? ''} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" type="number" min={1} aria-label={t('payAgents.admin_limit') ?? ''} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </div>
      <textarea className="input" rows={2} aria-label={t('payAgents.admin_instructions') ?? ''} placeholder={t('payAgents.admin_instructions') ?? ''} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary px-3 py-1 text-sm" onClick={() => void patch({ label: label.trim() || null, dailyLimit: parseInt(limit, 10) || 20, instructions: instructions.trim() || null })}>
          {t('library.save')}
        </button>
        {saved && <span className="text-sm text-green-700">{t('library.saved')}</span>}
        {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      </div>
    </li>
  );
}

export function PaymentAgentsAdmin() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ items: AgentRow[] }>('/api/admin/payment-agents').then((r) => setAgents(r.items)).catch(() => setAgents([]));
    api.get<{ items: OrderRow[] }>('/api/admin/payment-orders').then((r) => setOrders(r.items)).catch(() => setOrders([]));
  }, []);
  useEffect(load, [load]);

  async function add(person: { id: string }) {
    setError(null);
    try {
      await api.post('/api/admin/payment-agents', { personId: person.id });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('library.action_failed'));
    }
  }

  return (
    <section className="card space-y-3" data-testid="payment-agents-admin">
      <h3 className="font-semibold text-brand-900">{t('payAgents.admin_title')}</h3>
      <p className="text-sm text-slate-600">{t('payAgents.admin_help')}</p>
      <SearchPicker
        placeholder={t('library.search_person') ?? ''}
        searchPath="/api/admin/people?search="
        renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
        actionLabel={t('payAgents.admin_add')}
        searchButtonLabel={t('library.search')}
        onPick={(p) => void add(p)}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {agents && agents.length === 0 && <p className="text-sm text-slate-500">{t('payAgents.admin_none')}</p>}
      <ul className="divide-y divide-slate-100">
        {agents?.map((a) => (
          <AgentCard key={`${a.id}-${a.active}-${a.dailyLimit}-${a.label}`} a={a} onChanged={load} />
        ))}
      </ul>

      <h4 className="pt-2 font-semibold text-brand-900">{t('payAgents.admin_orders')}</h4>
      {orders.length === 0 ? (
        <p className="text-sm text-slate-500">{t('payAgents.admin_no_orders')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{o.buyerName}</strong> → {o.agentName} · {(o.bookCount ?? 1) > 1 ? t('payAgents.books_line', { count: o.bookCount }) : t('payAgents.book_line', { number: o.bookNumber ?? '' })} · {o.amount.toLocaleString('fr-FR')} FCFA
                {o.reference ? ` · ${o.reference}` : ''}
                {o.proofs > 0 ? ` · 📷${o.proofs}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">{t(`payAgents.status_${o.status.toLowerCase()}`)}</span>
                <button type="button" className="text-brand-700 underline" onClick={() => api.get<Thread>(`/api/admin/payment-orders/${o.id}`).then(setThread).catch(() => {})}>
                  {t('payAgents.admin_open')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {thread && (
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm" data-testid="order-thread">
          <div className="flex justify-between">
            <strong>{t('payAgents.admin_chat')}</strong>
            <button type="button" className="text-slate-500 underline" onClick={() => setThread(null)}>
              {t('payAgents.admin_close')}
            </button>
          </div>
          {thread.messages.map((m) => (
            <p key={m.id}>
              <span className="font-semibold">{m.senderName}:</span> {m.body}
              {m.hasProof && <Proof orderId={thread.id} messageId={m.id} />}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
