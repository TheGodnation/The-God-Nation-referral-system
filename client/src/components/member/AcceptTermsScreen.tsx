import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useMemberAuth } from '../../lib/MemberAuthContext';

// Shown once to a member who has not yet accepted the current Terms of Use and Privacy Policy
// (members from before the sign-up tick box, people added by an admin, or after the Terms change).
// Nothing else in the app opens until they accept or sign out.
export function AcceptTermsScreen() {
  const { t } = useTranslation();
  const { refresh, logout } = useMemberAuth();
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (!checked) {
      setError(t('memberSignup.error_terms'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.post('/api/member/auth/accept-terms', { accept: true });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('acceptTerms.failed'));
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <form onSubmit={accept} className="card w-full max-w-md space-y-4" data-testid="accept-terms-screen">
        <div className="flex justify-center">
          <img src="/icons/icon-192.png" alt="" className="h-16 w-16 rounded-full" />
        </div>
        <h1 className="text-center text-xl font-bold text-brand-900">{t('acceptTerms.title')}</h1>
        <p className="text-sm leading-relaxed text-slate-700">{t('acceptTerms.intro')}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>{t('acceptTerms.point_respect')}</li>
          <li>{t('acceptTerms.point_report')}</li>
          <li>{t('acceptTerms.point_privacy')}</li>
        </ul>
        <label className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-3 text-sm text-slate-800">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
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
        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={sending}>
          {sending ? t('acceptTerms.saving') : t('acceptTerms.continue')}
        </button>
        <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => void logout()}>
          {t('acceptTerms.sign_out')}
        </button>
      </form>
    </main>
  );
}
