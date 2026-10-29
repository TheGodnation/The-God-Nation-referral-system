import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { ContinueIfSignedIn } from '../components/ContinueIfSignedIn';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';
import { CodeEntry } from '../components/member/CodeEntry';
import { useEmailTypoCheck } from '../components/EmailTypoHint';

// Step 1 of joining the community: email, phone and a password. The server
// always gives the same reply (it never says whether someone is already
// known), so after submitting we simply tell the visitor to check their
// email. Step 2 (name + location) happens after they click the emailed
// link/code — from then on they sign back in with this password; a code is
// never sent again just to sign in.
export function MemberSignupPage() {
  return (
    <ContinueIfSignedIn sendStaff={false}>
      <MemberSignupPageInner />
    </ContinueIfSignedIn>
  );
}

function MemberSignupPageInner() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const emailTypo = useEmailTypoCheck(email, setEmail);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t('memberSignup.error_email'));
      return;
    }
    if (!whatsapp.trim()) {
      setError(t('memberSignup.error_phone'));
      return;
    }
    if (password.length < 8) {
      setError(t('memberSignup.error_password'));
      return;
    }
    if (!emailTypo.confirmBeforeSubmit()) return;
    setSubmitting(true);
    try {
      const language = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      await api.post('/api/member/auth/signup', { email: email.trim(), whatsapp: whatsapp.trim(), password, language });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_PHONE') setError(t('memberSignup.error_phone'));
      else if (err instanceof ApiError && err.code === 'INVALID_PASSWORD') setError(t('memberSignup.error_password'));
      else if (err instanceof ApiError && err.code === 'INVALID_INPUT') setError(t('memberSignup.error_email'));
      else setError(t('memberSignup.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('memberSignup.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('memberSignup.subtitle')}</p>

        {sent ? (
          <>
            <div role="status" className="mt-6 space-y-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
              <p className="font-medium">{t('memberSignup.sent_title')}</p>
              <p>{t('memberSignup.sent_message', { email: email.trim() })}</p>
            </div>
            <CodeEntry email={email.trim()} onChangeEmail={() => setSent(false)} />
          </>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
            <div>
              <label className="label" htmlFor="signup-email">
                {t('memberSignup.email_label')}
              </label>
              <input
                id="signup-email"
                type="email"
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={emailTypo.onBlur}
                required
                autoComplete="email"
              />
              {emailTypo.hint}
            </div>
            <div>
              <label className="label" htmlFor="signup-phone">
                {t('memberSignup.phone_label')}
              </label>
              <input
                id="signup-phone"
                className="input"
                placeholder="+237 6XX XXX XXX"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                required
                inputMode="tel"
                autoComplete="tel"
              />
              <p className="mt-1 text-xs text-slate-500">{t('memberSignup.phone_hint')}</p>
            </div>
            <div>
              <label className="label" htmlFor="signup-password">
                {t('memberSignup.password_label')}
              </label>
              <PasswordInput id="signup-password" value={password} onChange={setPassword} autoComplete="new-password" />
              <p className="mt-1 text-xs text-slate-500">{t('memberSignup.password_hint')}</p>
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('memberSignup.submitting') : t('memberSignup.submit')}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          {t('memberSignup.have_account')}{' '}
          <Link to="/member/login" className="font-medium text-brand-700 underline">
            {t('memberSignup.sign_in_link')}
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
