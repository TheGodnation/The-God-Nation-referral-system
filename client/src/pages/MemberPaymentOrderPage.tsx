import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { Avatar } from '../components/Avatar';
import { PresenceDot } from '../components/learn/PayWithAgent';
import { api, ApiError } from '../lib/api';
import { shrinkPhoto, uploadChatFile } from '../lib/chatMedia';

// One payment order: the chat between a member paying for a book and the
// ministry's payment agent (like a P2P trade). The agent's first message
// says how to pay; the member pays, sends the transaction ID ("I have paid")
// and can send a screenshot; the agent confirms the money reached the
// ministry's account — or says it did not, and the member sends the right ID.

interface OrderMessage {
  id: string;
  mine: boolean;
  senderName: string;
  body: string;
  auto: boolean;
  hasProof: boolean;
  createdAt: string;
}

interface Order {
  id: string;
  role: 'BUYER' | 'AGENT';
  status: 'OPEN' | 'CLAIMED' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  amount: number;
  bookNumber: number | null;
  bookCount: number;
  bookTitleEn: string | null;
  bookTitleFr: string | null;
  counterpart: { name: string; photoUrl: string | null; online: boolean; lastSeenAt: string | null; label: string | null };
  payment: { status: string; reference: string | null; payerPhone: string | null; note: string | null } | null;
  noReply?: boolean;
  canClaim: boolean;
  canCancel: boolean;
  canDecide: boolean;
  messages: OrderMessage[];
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;
const POLL_MS = 5000;

function ProofImage({ orderId, messageId }: { orderId: string; messageId: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<{ url: string }>(`/api/member/pay/orders/${orderId}/messages/${messageId}/proof-url`)
      .then((r) => alive && setUrl(r.url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [orderId, messageId]);
  if (failed) return <p className="text-xs italic text-slate-400">{t('payAgents.screenshot_unavailable')}</p>;
  if (!url) return <div className="h-24 w-40 animate-pulse rounded-lg bg-slate-200" aria-hidden />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={t('payAgents.screenshot') ?? ''} className="max-h-60 max-w-full rounded-lg object-contain" />
    </a>
  );
}

export function MemberPaymentOrderPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      setOrder(await api.get<Order>(`/api/member/pay/orders/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const count = order?.messages.length ?? 0;
    if (count !== lastCount.current) {
      lastCount.current = count;
      endRef.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [order?.messages.length]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('payAgents.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (await run(() => api.post(`/api/member/pay/orders/${id}/messages`, { body }))) setText('');
  }

  async function sendScreenshot(file: File) {
    setError(null);
    setBusy(true);
    try {
      const small = await shrinkPhoto(file);
      const up = await uploadChatFile(`/api/member/pay/orders/${id}/proof/authorize`, small, file.name || 'screenshot.jpg');
      await api.post(`/api/member/pay/orders/${id}/messages`, {
        proof: { storageKey: up.storageKey, mimeType: up.mimeType, byteSize: up.byteSize, originalFilename: up.originalFilename },
      });
      await load();
    } catch {
      setError(t('payAgents.screenshot_failed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (reference.trim().length < 3) return setError(t('payments.need_reference'));
    if (await run(() => api.post(`/api/member/pay/orders/${id}/paid`, { reference: reference.trim(), payerPhone: phone.trim() || undefined }))) {
      setClaiming(false);
      setReference('');
    }
  }

  if (missing) {
    return (
      <PageShell minimal>
        <section className="mx-auto max-w-2xl px-4 py-8">
          <p className="card text-slate-600">{t('payAgents.order_missing')}</p>
        </section>
      </PageShell>
    );
  }
  if (!order) {
    return (
      <PageShell minimal>
        <section className="mx-auto max-w-2xl px-4 py-8">
          <p className="text-sm text-slate-400">{t('memberDashboard.loading')}</p>
        </section>
      </PageShell>
    );
  }

  const isFr = i18n.language.startsWith('fr');
  const bookTitle = (isFr ? order.bookTitleFr || order.bookTitleEn : order.bookTitleEn) ?? '';
  const live = order.status === 'OPEN' || order.status === 'CLAIMED';
  const buyer = order.role === 'BUYER';
  const back = buyer ? '/member/school' : '/member/payment-desk';
  const presence = order.counterpart.online ? t('payAgents.online') : t('payAgents.offline');
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <PageShell minimal>
      <section className="mx-auto flex max-w-2xl flex-col px-4 py-4" style={{ minHeight: 'calc(100dvh - 7rem)' }}>
        <header className="mb-3 flex items-center gap-3">
          <Link to={back} aria-label={t('payAgents.back') ?? ''} className="text-2xl text-brand-700 no-underline">
            ‹
          </Link>
          <Avatar name={order.counterpart.name} photoUrl={order.counterpart.photoUrl} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-brand-900">{order.counterpart.name}</h1>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <PresenceDot online={order.counterpart.online} />
              {presence}
              {order.counterpart.label ? ` · ${order.counterpart.label}` : ''}
            </p>
          </div>
        </header>

        <div className="card mb-3 flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-900">{(order.bookCount > 1 ? t('payAgents.books_line', { count: order.bookCount }) : t('payAgents.book_line', { number: order.bookNumber ?? '' }))}</p>
            {order.bookCount === 1 && bookTitle && <p className="truncate text-xs text-slate-500">{bookTitle}</p>}
          </div>
          <div className="text-right">
            <p className="font-bold text-brand-900">{fcfa(order.amount)}</p>
            <p
              className={`text-xs font-semibold ${order.status === 'CONFIRMED' ? 'text-green-700' : order.status === 'CLAIMED' ? 'text-amber-700' : 'text-slate-500'}`}
              data-testid="order-status"
            >
              {t(`payAgents.status_${order.status.toLowerCase()}`)}
            </p>
          </div>
        </div>

        {buyer && order.status === 'OPEN' && order.payment?.status === 'REJECTED' && (
          <p role="status" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {t('payAgents.not_found_banner')}
            {order.payment.note ? ` ${order.payment.note}` : ''}
          </p>
        )}
        {buyer && order.noReply && (
          <div role="status" className="mb-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="no-reply">
            <p>{t('payAgents.no_reply')}</p>
            {order.status === 'OPEN' && (
              <button
                type="button"
                className="font-semibold underline"
                disabled={busy}
                onClick={() => void run(() => api.post(`/api/member/pay/orders/${id}/cancel`)).then((ok) => ok && navigate('/member/school'))}
              >
                {t('payAgents.choose_another')}
              </button>
            )}
          </div>
        )}
        {buyer && order.status === 'CLAIMED' && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('payAgents.agent_checking')}</p>}
        {order.status === 'CONFIRMED' && (
          <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {buyer ? t('payAgents.confirmed_buyer') : t('payAgents.confirmed_agent')}{' '}
            {buyer && (
              <Link to="/member/school" className="font-semibold underline">
                {t('payAgents.open_school')}
              </Link>
            )}
          </p>
        )}
        {(order.status === 'CANCELLED' || order.status === 'EXPIRED') && <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{t('payAgents.closed_note')}</p>}

        {order.canDecide && order.payment && (
          <div className="card mb-3 space-y-2 border-amber-300 bg-amber-50" data-testid="decide-box">
            <p className="font-semibold text-amber-900">{t('payAgents.check_payment')}</p>
            <p className="text-sm text-slate-800">
              {t('payAgents.reference_is')} <strong className="font-mono">{order.payment.reference}</strong>
              {order.payment.payerPhone ? ` · ${order.payment.payerPhone}` : ''} · {fcfa(order.amount)}
            </p>
            <p className="text-xs text-slate-600">{t('payAgents.check_hint')}</p>
            {rejecting ? (
              <div className="space-y-2">
                <input className="input" aria-label={t('payAgents.reject_note') ?? ''} placeholder={t('payAgents.reject_note') ?? ''} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(() => api.post(`/api/member/pay/orders/${id}/decide`, { decision: 'REJECT', note: note.trim() || undefined })).then(() => setRejecting(false))}>
                    {t('payAgents.send_not_found')}
                  </button>
                  <button type="button" className="text-slate-500 underline" onClick={() => setRejecting(false)}>
                    {t('payments.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(() => api.post(`/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' }))}>
                  ✅ {t('payAgents.confirm')}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRejecting(true)}>
                  {t('payAgents.not_received')}
                </button>
              </div>
            )}
          </div>
        )}

        {order.canClaim && (
          <div className="card mb-3 space-y-2">
            {claiming ? (
              <form onSubmit={claim} className="space-y-2" noValidate>
                <label className="label" htmlFor="order-ref">
                  {t('payments.reference_label')}
                </label>
                <input id="order-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="MP241021.1234.A56789" />
                <label className="label" htmlFor="order-phone">
                  {t('payments.phone_label')}
                </label>
                <input id="order-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+237 6XX XXX XXX" />
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {t('payments.i_have_paid')}
                  </button>
                  <button type="button" className="text-slate-500 underline" onClick={() => setClaiming(false)}>
                    {t('payments.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-primary" onClick={() => setClaiming(true)}>
                  ✅ {t('payments.i_have_paid')}
                </button>
                {order.canCancel && (
                  <button type="button" className="text-sm text-slate-500 underline" disabled={busy} onClick={() => void run(() => api.post(`/api/member/pay/orders/${id}/cancel`))}>
                    {t('payAgents.cancel_order')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <ul className="mb-3 flex-1 space-y-2 pb-16" aria-label={t('payAgents.messages') ?? ''}>
          {order.messages.map((m) => (
            <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.mine ? 'bg-brand-600 text-white' : 'bg-white text-slate-800'}`}>
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.hasProof && <ProofImage orderId={order.id} messageId={m.id} />}
                <p className={`mt-1 text-right text-[10px] ${m.mine ? 'text-brand-100' : 'text-slate-400'}`}>{time(m.createdAt)}</p>
              </div>
            </li>
          ))}
          <div ref={endRef} />
        </ul>

        {error && (
          <p role="alert" className="mb-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {live && (
          <form onSubmit={send} className="sticky bottom-20 flex items-end gap-2 rounded-2xl bg-white p-2 shadow-md">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label={t('payAgents.add_screenshot') ?? ''}
              onChange={(e) => e.target.files?.[0] && void sendScreenshot(e.target.files[0])}
            />
            <button type="button" className="rounded-full p-2 text-xl hover:bg-slate-100" aria-label={t('payAgents.add_screenshot') ?? ''} disabled={busy} onClick={() => fileRef.current?.click()}>
              📷
            </button>
            <textarea className="input min-h-[2.5rem] flex-1 resize-none" rows={1} aria-label={t('payAgents.write') ?? ''} placeholder={t('payAgents.write') ?? ''} value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn-primary px-4" disabled={busy || !text.trim()}>
              {t('payAgents.send')}
            </button>
          </form>
        )}
      </section>
    </PageShell>
  );
}
