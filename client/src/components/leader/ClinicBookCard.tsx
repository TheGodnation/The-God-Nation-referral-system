import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Status {
  book: { id: string; titleEn: string; titleFr: string | null } | null;
  // Leader view
  people?: number;
  // Central view
  members?: number;
  sent: number;
  waiting: number;
}

// The monthly Dominion Clinic book: how many have it, and one tap to send it to
// the rest as a private message. A leader sends to their own people; the
// central admin to everyone. Anyone it has not reached by then gets it
// automatically two days after it opens.
export function ClinicBookCard({ statusUrl, sendUrl, mode }: { statusUrl: string; sendUrl: string; mode: 'leader' | 'central' }) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function load() {
    api.get<Status>(statusUrl).then(setStatus).catch(() => {});
  }
  useEffect(load, [statusUrl]);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.post<{ sent: number }>(sendUrl, {});
      setMessage({ kind: 'ok', text: r.sent === 0 ? t('clinic.send_nobody') : t(mode === 'leader' ? 'clinic.send_done' : 'clinic.admin_done', { count: r.sent }) });
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t('clinic.send_failed') });
    } finally {
      setBusy(false);
    }
  }

  if (!status || !status.book) return null;
  const title = isFr ? status.book.titleFr || status.book.titleEn : status.book.titleEn;
  const total = mode === 'leader' ? status.people ?? 0 : status.members ?? 0;
  if (mode === 'leader' && total === 0) return null;

  return (
    <section className="card space-y-2" data-testid="clinic-book-card">
      <h2 className="font-semibold text-brand-900">{t('clinic.leader_title')}</h2>
      <p className="text-sm text-slate-700">
        {mode === 'leader'
          ? t('clinic.leader_help', { title, sent: status.sent, people: total })
          : t('clinic.admin_help', { title, sent: status.sent, members: total })}
      </p>
      {status.waiting > 0 && (
        <button type="button" className="btn-primary" disabled={busy} onClick={send}>
          {mode === 'leader' ? t('clinic.send_button', { count: status.waiting }) : t('clinic.admin_send_all', { count: status.waiting })}
        </button>
      )}
      {mode === 'central' && <p className="text-xs text-slate-500">{t('clinic.admin_auto')}</p>}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
