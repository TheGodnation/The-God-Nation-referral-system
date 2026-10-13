import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { CodeEntry } from '../components/member/CodeEntry';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';

// Member sign-in: email + password, the ordinary way back in once someone
// has already signed up. "Forgot password, or never set one?" switches to
// the one other place a code is ever sent after sign-up — it always shows
// that link, never only when the password attempt fails, so offering it is
// never itself a sign of anything.
export function MemberLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refresh } = useMemberAuth();

  const [mode, setMode] = useState<'password' | 'code-request' | 'code-entry'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [codeEmail, setCodeEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      setError(t('memberLogin.error_email'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/member/auth/login', { email: clean, password });
      await refresh();
      navigate('/member/chats', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' ? t('memberLogin.error_credentials') : t('memberLogin.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      setError(t('memberLogin.error_email'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/member/auth/request-code', { email: clean });
      setCodeEmail(clean);
      setMode('code-entry');
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INVALID_EMAIL' ? t('memberLogin.error_email') : t('memberLogin.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('memberLogin.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {t(mode === 'password' ? 'memberLogin.subtitle_password' : 'memberLogin.subtitle_code')}
        </p>

        {mode === 'code-entry' ? (
          <CodeEntry email={codeEmail} onChangeEmail={() => setMode('password')} requirePassword />
        ) : (
          <form onSubmit={mode === 'password' ? onSubmitPassword : onRequestCode} className="mt-6 space-y-5" noValidate>
            <div>
              <label className="label" htmlFor="member-email">
                {t('memberLogin.email_label')}
              </label>
              <input
                id="member-email"
                type="email"
                className="input"
                placeholder={t('memberLogin.email_placeholder') ?? ''}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {mode === 'password' && (
              <div>
                <label className="label" htmlFor="member-password">
                  {t('memberLogin.password_label')}
                </label>
                <PasswordInput id="member-password" value={password} onChange={setPassword} autoComplete="current-password" />
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting
                ? t('memberLogin.submitting')
                : t(mode === 'password' ? 'memberLogin.submit' : 'memberLogin.submit_code')}
            </button>

            {mode === 'password' ? (
              <button type="button" className="block w-full text-center text-sm text-brand-700 underline" onClick={() => { setError(null); setMode('code-request'); }}>
                {t('memberLogin.forgot_password_link')}
              </button>
            ) : (
              <button type="button" className="block w-full text-center text-sm text-slate-500 underline" onClick={() => { setError(null); setMode('password'); }}>
                {t('memberLogin.back_to_password_link')}
              </button>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          {t('memberLogin.new_here')}{' '}
          <Link to="/member/join" className="font-medium text-brand-700 underline">
            {t('memberLogin.join_link')}
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
