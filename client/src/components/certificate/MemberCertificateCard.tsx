import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useStoreApp } from '../../lib/storeApp';
import { CertLang } from '../../lib/certificateRender';
import { CertificateCanvas, downloadCertificate } from './CertificateCanvas';

// The student's side of the Academy diploma, on the Academy page: an example of it, then (once every book is passed) a
// request (name as it should be printed, language, how to receive it), then where it stands, and finally the
// certificate itself. The price is agreed privately by the Academy and is never shown here.

export interface CertificateRequestView {
  status: 'REQUESTED' | 'PAID' | 'ISSUED' | 'DELIVERED' | 'CANCELLED';
  nameOnCertificate: string;
  language: CertLang;
  delivery: 'POST' | 'EMAIL' | 'COLLECT';
  contactPhone: string | null;
  address: string | null;
  requestedAt: string;
  certificateNumber: string | null;
  issuedAt: string | null;
  deliveredAt: string | null;
}

export interface CertificateInfo {
  eligible: boolean;
  passed: number;
  total: number;
  defaultName: string;
  defaultLanguage: CertLang;
  request: CertificateRequestView | null;
}

const SAMPLE_NAME = 'John Doe';

export function MemberCertificateCard({ info, onChanged }: { info: CertificateInfo; onChanged: () => void }) {
  const { t } = useTranslation();
  const store = useStoreApp();
  const [showSample, setShowSample] = useState(false);
  const [editing, setEditing] = useState(false);
  const request = info.request;
  const year = new Date().getFullYear();
  const lang: CertLang = request?.language ?? info.defaultLanguage;
  const sample = { name: SAMPLE_NAME, number: `GNLA-${year}-001`, issuedAt: new Date(), lang };

  return (
    <section className="card space-y-3" data-testid="certificate-card">
      <h2 className="text-lg font-semibold text-brand-900">🎓 {t('certificate.title')}</h2>

      {!request && !info.eligible && <p className="text-sm text-slate-700">{t('certificate.not_yet', { total: info.total, passed: info.passed })}</p>}

      {!request && info.eligible && store && <p className="text-sm text-slate-700">{t('certificate.website_only')}</p>}

      {!request && info.eligible && !store && !editing && (
        <>
          <p className="text-sm text-slate-700">{t('certificate.passed_all')}</p>
          <button type="button" className="btn-primary" onClick={() => setEditing(true)} data-testid="certificate-ask">
            {t('certificate.ask_button')}
          </button>
        </>
      )}

      {editing && !store && (
        <CertificateForm
          info={info}
          initial={request}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}

      {request && !editing && <RequestStatus request={request} onChange={() => setEditing(true)} />}

      {!request && (
        <div>
          <button type="button" className="text-sm text-brand-700 underline" onClick={() => setShowSample(!showSample)} data-testid="certificate-sample-toggle">
            {showSample ? t('certificate.sample_close') : t('certificate.sample_example')}
          </button>
          {showSample && (
            <div className="mt-2 space-y-1" data-testid="certificate-sample">
              <CertificateCanvas data={sample} alt={t('certificate.alt_sample')} />
              <p className="text-xs text-slate-500">{t('certificate.sample_note')}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RequestStatus({ request, onChange }: { request: CertificateRequestView; onChange: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const issued = request.status === 'ISSUED' || request.status === 'DELIVERED';
  const statusText = { REQUESTED: 'status_requested', PAID: 'status_paid', ISSUED: 'status_issued', DELIVERED: 'status_delivered', CANCELLED: 'status_requested' }[request.status];
  const data = issued && request.certificateNumber && request.issuedAt ? { name: request.nameOnCertificate, number: request.certificateNumber, issuedAt: request.issuedAt, lang: request.language } : null;

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      await downloadCertificate(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm" data-testid="certificate-status">
      <p className={`rounded-lg px-3 py-2 font-medium ${issued ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>{t(`certificate.${statusText}`)}</p>
      <dl className="grid gap-1 text-slate-700">
        <div>
          <dt className="inline font-semibold">{t('certificate.your_name')}: </dt>
          <dd className="inline">{request.nameOnCertificate}</dd>
        </div>
        {request.certificateNumber && (
          <div>
            <dt className="inline font-semibold">{t('certificate.number')}: </dt>
            <dd className="inline">{request.certificateNumber}</dd>
          </div>
        )}
      </dl>
      <p className="text-slate-700">
        {request.delivery === 'POST' && t('certificate.how_post', { address: request.address ?? '' })}
        {request.delivery === 'EMAIL' && t('certificate.how_email')}
        {request.delivery === 'COLLECT' && t('certificate.how_collect')}
      </p>
      {data && (
        <div className="space-y-2">
          <CertificateCanvas data={data} alt={t('certificate.alt', { name: request.nameOnCertificate })} />
          {request.delivery === 'EMAIL' && (
            <button type="button" className="btn-primary" disabled={busy} onClick={save} data-testid="certificate-download">
              {busy ? t('certificate.downloading') : t('certificate.download')}
            </button>
          )}
        </div>
      )}
      {request.status === 'REQUESTED' && (
        <button type="button" className="text-brand-700 underline" onClick={onChange} data-testid="certificate-change">
          {t('certificate.change')}
        </button>
      )}
    </div>
  );
}

function CertificateForm({ info, initial, onCancel, onSaved }: { info: CertificateInfo; initial: CertificateRequestView | null; onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.nameOnCertificate ?? info.defaultName);
  const [language, setLanguage] = useState<CertLang>(initial?.language ?? info.defaultLanguage);
  const [delivery, setDelivery] = useState<'POST' | 'EMAIL' | 'COLLECT'>(initial?.delivery ?? 'EMAIL');
  const [phone, setPhone] = useState(initial?.contactPhone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/member/certificate', { name, language, delivery, ...(delivery !== 'EMAIL' ? { phone } : {}), ...(delivery === 'POST' ? { address } : {}) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('certificate.failed'));
    } finally {
      setBusy(false);
    }
  }

  const choice = 'flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm';
  return (
    <form onSubmit={submit} className="space-y-3 text-sm" data-testid="certificate-form">
      <label className="block">
        <span className="font-medium text-slate-800">{t('certificate.form_name')}</span>
        <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-testid="certificate-name" />
        <span className="text-xs text-slate-500">{t('certificate.form_name_hint')}</span>
      </label>

      <fieldset className="space-y-1">
        <legend className="font-medium text-slate-800">{t('certificate.form_language')}</legend>
        <div className="flex gap-2">
          {(['en', 'fr'] as const).map((l) => (
            <label key={l} className={choice}>
              <input type="radio" name="cert-lang" checked={language === l} onChange={() => setLanguage(l)} />
              <span>{t(`certificate.lang_${l}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="font-medium text-slate-800">{t('certificate.form_delivery')}</legend>
        {(['EMAIL', 'POST', 'COLLECT'] as const).map((d) => (
          <label key={d} className={choice}>
            <input type="radio" name="cert-delivery" checked={delivery === d} onChange={() => setDelivery(d)} data-testid={`certificate-delivery-${d}`} />
            <span>{t(`certificate.delivery_${d.toLowerCase()}`)}</span>
          </label>
        ))}
      </fieldset>

      {delivery === 'POST' && (
        <label className="block">
          <span className="font-medium text-slate-800">{t('certificate.form_address')}</span>
          <textarea className="input mt-1" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} data-testid="certificate-address" />
        </label>
      )}
      {delivery !== 'EMAIL' && (
        <label className="block">
          <span className="font-medium text-slate-800">{t('certificate.form_phone')}</span>
          <input className="input mt-1" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} data-testid="certificate-phone" />
        </label>
      )}

      <div className="space-y-1">
        <p className="font-medium text-slate-800">{t('certificate.preview')}</p>
        <CertificateCanvas data={{ name: name.trim() || '…', number: `GNLA-${new Date().getFullYear()}-001`, issuedAt: new Date(), lang: language }} alt={t('certificate.alt', { name })} />
      </div>

      <p className="text-slate-600">{t('certificate.contact_note')}</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy} data-testid="certificate-submit">
          {initial ? t('certificate.update') : t('certificate.submit')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('certificate.sample_close')}
        </button>
      </div>
    </form>
  );
}
