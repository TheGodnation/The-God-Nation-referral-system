import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { usePublicSettings } from '../../lib/usePublicSettings';
import { adsConfigured } from '../../lib/adsTracking';
import { AdsDeviceChoice } from '../AdsDeviceChoice';

interface Consent {
  whatsapp: boolean | null;
  email: boolean | null;
  ads?: boolean | null;
}

// The member's own choices about being contacted by WhatsApp and email.
// Every change is saved at once (and kept as a dated record on the server).
export function ContactPreferencesCard() {
  const { t } = useTranslation();
  const [c, setC] = useState<Consent | null>(null);
  const settings = usePublicSettings();
  const showAds = adsConfigured(settings.ads);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<Consent>('/api/member/contact-consent').then(setC).catch(() => {});
  }, []);

  if (!c) return null;

  async function change(channel: keyof Consent, value: boolean) {
    setMessage(null);
    const before = c;
    setC({ ...c!, [channel]: value });
    try {
      setC(await api.put<Consent>('/api/member/contact-consent', { [channel]: value }));
      setMessage({ ok: true, text: t('contactPrefs.saved') });
    } catch {
      setC(before);
      setMessage({ ok: false, text: t('contactPrefs.failed') });
    }
  }

  const row = (channel: keyof Consent, label: string, id: string) => (
    <label className="flex items-start gap-2 text-sm text-slate-700" htmlFor={id}>
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={c[channel] === true} onChange={(e) => void change(channel, e.target.checked)} />
      <span>
        {label}
        {c[channel] === null && <span className="ml-2 text-xs text-slate-400">({t('contactPrefs.not_answered')})</span>}
      </span>
    </label>
  );

  return (
    <section className="mt-3 rounded-xl bg-white p-4 shadow-sm" data-testid="contact-prefs">
      <h2 className="font-semibold text-brand-900">{t('contactPrefs.title')}</h2>
      <p className="mt-1 text-xs text-slate-500">{t('contactPrefs.help')}</p>
      <div className="mt-3 space-y-2">
        {row('whatsapp', t('contactPrefs.whatsapp'), 'prefs-whatsapp')}
        {row('email', t('contactPrefs.email'), 'prefs-email')}
        {showAds && row('ads', t('contactPrefs.ads'), 'prefs-ads')}
      </div>
      {showAds && (
        <div className="mt-3">
          <AdsDeviceChoice />
        </div>
      )}
      {message && (
        <p role="status" className={`mt-2 text-xs font-medium ${message.ok ? 'text-green-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
