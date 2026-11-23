import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { GoogleSignInButton } from './GoogleSignInButton';
import { PhoneInput } from './PhoneInput';
import { usePublicSettings } from '../lib/usePublicSettings';
import { adsConfigured, getFbp, newAdEventId, trackAd } from '../lib/adsTracking';

// "Continue with Google" for both the sign-in page and the join page. A member who already has an account is signed in at once.
// Someone new gets a short form (their WhatsApp number, the Terms and the optional agreements) and joins with no emailed code and
// no password: Google has already confirmed the email.

type Done = { member?: unknown; codeRequired?: boolean; email?: string };

// Only to show the person which email Google gave (the server checks the token itself and never trusts this).
function emailInToken(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

export function GoogleAccess({ onSignedIn, onCodeRequired, onError }: {
  /** The server's reply once the person is signed in (an existing member, or a new one who just joined). */
  onSignedIn: (response: unknown) => void;
  /** The central admin's profile on a new phone: the emailed code is still needed. */
  onCodeRequired: (email: string) => void;
  onError?: (message: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const settings = usePublicSettings();
  const showAds = adsConfigured(settings.ads);
  const [credential, setCredential] = useState<string | null>(null);
  const [joinEmail, setJoinEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [consentEmail, setConsentEmail] = useState(false);
  const [consentAds, setConsentAds] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(message: string | null) {
    setError(message);
    onError?.(message);
  }

  async function onCredential(token: string) {
    fail(null);
    try {
      const res = await api.post<Done>('/api/member/auth/google', { credential: token });
      if (res?.codeRequired && res.email) return onCodeRequired(res.email);
      onSignedIn(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_ACCOUNT') {
        // Nobody uses this Google email yet: ask for the little that is still needed to join.
        setCredential(token);
        setJoinEmail(emailInToken(token));
      } else fail(t('memberLogin.google_failed'));
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    fail(null);
    if (!whatsapp.trim()) return fail(t('memberSignup.error_phone'));
    if (!acceptTerms) return fail(t('memberSignup.error_terms'));
    setSubmitting(true);
    try {
      const adEventId = newAdEventId();
      const ads = showAds && consentAds;
      const res = await api.post('/api/member/auth/google/join', {
        credential,
        whatsapp: whatsapp.trim(),
        language: i18n.language?.startsWith('fr') ? 'fr' : 'en',
        consentWhatsapp,
        consentEmail,
        acceptTerms: true,
        ...(ads ? { consentAds: true, adEventId, fbp: getFbp() } : {}),
      });
      trackAd('Lead', adEventId);
      onSignedIn(res);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      if (code === 'INVALID_PHONE') fail(t('memberSignup.error_phone'));
      else if (code === 'TERMS_REQUIRED') fail(t('memberSignup.error_terms'));
      else if (code === 'ACCOUNT_EXISTS') {
        setCredential(null);
        fail(t('memberLogin.google_join_exists'));
      } else if (code === 'CANNOT_JOIN') fail(t('memberLogin.google_join_cannot'));
      else if (code === 'BAD_GOOGLE') {
        setCredential(null);
        fail(t('memberLogin.google_failed'));
      } else fail(t('memberSignup.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="google-area">
      {!credential && <GoogleSignInButton onCredential={(c) => void onCredential(c)} />}
      {credential && (
        <form onSubmit={onJoin} className="space-y-4 rounded-xl border border-brand-100 bg-white p-4" noValidate data-testid="google-join">
          <div>
            <h2 className="text-lg font-bold text-brand-900">{t('memberLogin.google_join_title')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('memberLogin.google_join_intro', { email: joinEmail || '' })}</p>
          </div>
          <div>
            <label className="label" htmlFor="google-join-phone">{t('memberSignup.phone_label')}</label>
            <PhoneInput id="google-join-phone" onChange={setWhatsapp} required />
            <p className="mt-1 text-xs text-slate-500">{t('memberSignup.phone_hint')}</p>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-3 text-sm text-slate-800" data-testid="google-join-terms">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required aria-required="true" />
            <span>
              <Trans
                i18nKey="memberSignup.accept_terms"
                components={{
                  terms: <Link to="/terms" target="_blank" rel="noopener" className="font-medium text-brand-700 underline" />,
                  privacy: <Link to="/privacy" target="_blank" rel="noopener" className="font-medium text-brand-700 underline" />,
                }}
              />
            </span>
          </label>
          <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-3">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consentWhatsapp} onChange={(e) => setConsentWhatsapp(e.target.checked)} />
              <span>{t('memberSignup.consent_whatsapp')}</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} />
              <span>{t('memberSignup.consent_email')}</span>
            </label>
            {showAds && (
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consentAds} onChange={(e) => setConsentAds(e.target.checked)} />
                <span>{t('memberSignup.consent_ads')}</span>
              </label>
            )}
            <p className="text-xs text-slate-500">{t('memberSignup.consent_hint')}</p>
          </div>
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t('memberLogin.google_join_submitting') : t('memberLogin.google_join_submit')}
          </button>
          <button type="button" className="block w-full text-center text-sm text-slate-500 underline" onClick={() => { setCredential(null); fail(null); }}>
            {t('memberLogin.google_join_other')}
          </button>
        </form>
      )}
      {!credential && error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      )}
    </div>
  );
}
