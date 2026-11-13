import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { CertLang } from '../../lib/certificateRender';
import { CertificateCanvas, downloadCertificate } from '../certificate/CertificateCanvas';

// The central admin's list of certificate requests (Admin → Library): who asked, how they want to receive it, a private
// note for the price agreed (never shown to the student), and the steps: paid, issued (gets its number and date),
// delivered, or cancelled. The certificate itself can be previewed (to check the spelling) and saved as a picture to
// send or print.

type Status = 'REQUESTED' | 'PAID' | 'ISSUED' | 'DELIVERED' | 'CANCELLED';
interface Item {
  id: string;
  personId: string;
  accountName: string;
  whatsappNumber: string | null;
  email: string | null;
  nameOnCertificate: string;
  language: CertLang;
  delivery: 'POST' | 'EMAIL' | 'COLLECT';
  contactPhone: string | null;
  address: string | null;
  status: Status;
  adminNote: string | null;
  certificateNumber: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  requestedAt: string;
}

export function CertificatesAdmin() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(0);
  const [filter, setFilter] = useState<'' | Status>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ items: Item[]; open: number }>(`/api/admin/certificates${filter ? `?status=${filter}` : ''}`)
      .then((r) => {
        setItems(r.items);
        setOpen(r.open);
      })
      .catch(() => setError(t('certificateAdmin.failed')));
  }, [filter, t]);
  useEffect(load, [load]);

  return (
    <section className="card space-y-3" data-testid="certificates-admin">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-brand-900">
          {t('certificateAdmin.title')} {open > 0 && <span className="ml-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs text-amber-950">{t('certificateAdmin.waiting', { count: open })}</span>}
        </h3>
        <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as '' | Status)} aria-label={t('certificateAdmin.filter_all') ?? ''} data-testid="certificate-filter">
          <option value="">{t('certificateAdmin.filter_all')}</option>
          {(['REQUESTED', 'PAID', 'ISSUED', 'DELIVERED', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`certificateAdmin.status_${s}`)}
            </option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {items && items.length === 0 && <p className="text-sm text-slate-500">{t('certificateAdmin.none')}</p>}
      <ul className="space-y-3">
        {(items ?? []).map((item) => (
          <CertificateRow key={item.id} item={item} onChanged={load} />
        ))}
      </ul>
    </section>
  );
}

function CertificateRow({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(item.nameOnCertificate);
  const [note, setNote] = useState(item.adminNote ?? '');
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const issued = item.status === 'ISSUED' || item.status === 'DELIVERED';
  const date = (value: string) => new Date(value).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (done) setInfo(done);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('certificateAdmin.failed'));
    } finally {
      setBusy(false);
    }
  }
  const act = (step: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    void run(() => api.post(`/api/admin/certificates/${item.id}/${step}`, {}));
  };
  const save = () => run(() => api.patch(`/api/admin/certificates/${item.id}`, { adminNote: note, ...(issued ? {} : { nameOnCertificate: name }) }), t('certificateAdmin.saved'));
  const send = () => run(async () => {
    await api.post(`/api/admin/library/trainees/${item.personId}/message`, { body: message });
    setMessage('');
  }, t('certificateAdmin.message_sent'));

  const data = { name: name.trim() || item.nameOnCertificate, number: item.certificateNumber ?? `GNLA-${new Date().getFullYear()}-001`, issuedAt: item.issuedAt ?? new Date(), lang: item.language };
  const whatsapp = item.whatsappNumber ? `https://wa.me/${item.whatsappNumber.replace(/\D/g, '')}` : null;
  const badge: Record<Status, string> = { REQUESTED: 'bg-amber-100 text-amber-900', PAID: 'bg-blue-100 text-blue-900', ISSUED: 'bg-green-100 text-green-900', DELIVERED: 'bg-green-200 text-green-950', CANCELLED: 'bg-slate-200 text-slate-700' };

  return (
    <li className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm" data-testid={`certificate-row-${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{item.nameOnCertificate}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[item.status]}`}>{t(`certificateAdmin.status_${item.status}`)}</span>
      </div>
      <p className="text-slate-600">
        {t('certificateAdmin.account', { name: item.accountName })} · {t(`certificateAdmin.delivery_${item.delivery}`)} · {item.language.toUpperCase()} · {t('certificateAdmin.asked_on', { date: date(item.requestedAt) })}
      </p>
      {item.address && <p className="text-slate-700">{t('certificateAdmin.address', { address: item.address })}</p>}
      <p className="flex flex-wrap gap-x-3 text-slate-700">
        {item.contactPhone && <span>{t('certificateAdmin.phone', { phone: item.contactPhone })}</span>}
        {item.email && <span>{t('certificateAdmin.email', { email: item.email })}</span>}
        {whatsapp && (
          <a className="text-brand-700 underline" href={whatsapp} target="_blank" rel="noreferrer">
            {t('certificateAdmin.whatsapp')}
          </a>
        )}
      </p>
      {item.certificateNumber && item.issuedAt && (
        <p className="font-medium text-green-800">
          {t('certificateAdmin.number', { number: item.certificateNumber })} · {t('certificateAdmin.issued_on', { date: date(item.issuedAt) })}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('certificateAdmin.name_label')}</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} disabled={issued} maxLength={80} data-testid={`certificate-name-${item.id}`} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">{t('certificateAdmin.note_label')}</span>
          <textarea className="input mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} data-testid={`certificate-note-${item.id}`} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={save} data-testid={`certificate-save-${item.id}`}>
          {t('certificateAdmin.save')}
        </button>
        {item.status === 'REQUESTED' && (
          <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => act('paid')} data-testid={`certificate-paid-${item.id}`}>
            {t('certificateAdmin.mark_paid')}
          </button>
        )}
        {(item.status === 'REQUESTED' || item.status === 'PAID') && (
          <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => act('issue', t('certificateAdmin.issue_confirm', { name: item.nameOnCertificate }) ?? undefined)} data-testid={`certificate-issue-${item.id}`}>
            {t('certificateAdmin.issue')}
          </button>
        )}
        {item.status === 'ISSUED' && (
          <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => act('delivered')} data-testid={`certificate-delivered-${item.id}`}>
            {t('certificateAdmin.delivered')}
          </button>
        )}
        {(item.status === 'REQUESTED' || item.status === 'PAID') && (
          <button type="button" className="px-2 py-1 text-xs text-red-700 underline" disabled={busy} onClick={() => act('cancel', t('certificateAdmin.cancel_confirm') ?? undefined)} data-testid={`certificate-cancel-${item.id}`}>
            {t('certificateAdmin.cancel')}
          </button>
        )}
        {item.status !== 'CANCELLED' && (
          <button type="button" className="px-2 py-1 text-xs text-brand-700 underline" onClick={() => setPreview(!preview)} data-testid={`certificate-preview-${item.id}`}>
            {preview ? t('certificateAdmin.hide_preview') : t('certificateAdmin.preview')}
          </button>
        )}
        {issued && (
          <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => run(() => downloadCertificate(data))} data-testid={`certificate-download-${item.id}`}>
            {t('certificateAdmin.download')}
          </button>
        )}
      </div>

      {preview && (
        <div className="space-y-1">
          <CertificateCanvas data={data} alt={t('certificate.alt', { name: data.name })} />
          {!issued && <p className="text-xs text-slate-500">{t('certificateAdmin.preview_note')}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <input className="input flex-1" placeholder={t('certificateAdmin.message_label') ?? ''} aria-label={t('certificateAdmin.message_label') ?? ''} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} data-testid={`certificate-message-${item.id}`} />
        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy || !message.trim()} onClick={send} data-testid={`certificate-send-${item.id}`}>
          {t('certificateAdmin.message_send')}
        </button>
      </div>
      {info && <p role="status" className="text-green-800">{info}</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </li>
  );
}
