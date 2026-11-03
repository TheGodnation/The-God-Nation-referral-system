import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, ensureCsrfReady } from '../lib/api';
import { CommunityChoices } from './CommunityChoices';
import { usePublicSettings } from '../lib/usePublicSettings';
import { newAdEventId, trackAd } from '../lib/adsTracking';

// "Stay connected": for visitors who are not ready to make an account. A name
// and a WhatsApp number, and their own tick to agree to updates on WhatsApp.
// Nothing is kept without the tick (the server refuses it as well).
export function StayConnected({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const settings = usePublicSettings();
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureCsrfReady();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('stayConnected.error_name'));
    if (!whatsapp.trim()) return setError(t('stayConnected.error_phone'));
    if (!agree) return setError(t('stayConnected.error_consent'));
    setBusy(true);
    try {
      await api.post('/api/leads', {
        name: name.trim(),
        whatsapp: whatsapp.trim(),
        language: i18n.language?.startsWith('fr') ? 'fr' : 'en',
        consentWhatsapp: true,
      });
      trackAd('Lead', newAdEventId());
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_PHONE') setError(t('stayConnected.error_phone'));
      else if (err instanceof ApiError && err.code === 'CONSENT_REQUIRED') setError(t('stayConnected.error_consent'));
      else setError(t('stayConnected.error_generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`} data-testid="stay-connected">
      <h2 className="text-lg font-bold text-brand-900">{t('stayConnected.title')}</h2>
      {done ? (
        <>
          <div role="status" className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            <p className="font-medium">{t('stayConnected.thanks_title')}</p>
            <p>{t('stayConnected.thanks_body')}</p>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-brand-900">{t('stayConnected.choose_title')}</p>
            <p className="mb-3 text-xs text-slate-500">{t('stayConnected.choose_body')}</p>
            <CommunityChoices
              settings={settings}
              titleKeyPrefix="stayConnected"
              onTap={(platform) => void api.post('/api/leads/click', { platform }).catch(() => {})}
            />
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="mt-2 space-y-3" noValidate>
          <p className="text-sm text-slate-600">{t('stayConnected.body')}</p>
          <div>
            <label className="label" htmlFor="stay-name">{t('stayConnected.name_label')}</label>
            <input id="stay-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="stay-phone">{t('stayConnected.phone_label')}</label>
            <input id="stay-phone" className="input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+237 6XX XXX XXX" inputMode="tel" autoComplete="tel" />
            <p className="mt-1 text-xs text-slate-500">{t('stayConnected.phone_hint')}</p>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              {t('stayConnected.consent')}
              <span className="block text-xs text-slate-500">{t('stayConnected.consent_note')}</span>
            </span>
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t('stayConnected.submitting') : t('stayConnected.submit')}
          </button>
        </form>
      )}
    </section>
  );
}
