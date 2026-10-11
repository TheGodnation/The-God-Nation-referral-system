import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { CodeEntry } from '../components/member/CodeEntry';
import { api, ApiError } from '../lib/api';

// Member sign-in, made simple: type your email, then the 6-digit code we
// email you. The server's reply never says whether the email belongs to a
// member (same reply either way).
export function MemberLoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
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
      setSentTo(clean);
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
        <p className="mt-2 text-sm text-slate-500">{t('memberLogin.subtitle_email')}</p>

        {sentTo ? (
          <CodeEntry email={sentTo} onChangeEmail={() => setSentTo(null)} />
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
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

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('memberLogin.submitting') : t('memberLogin.submit_code')}
            </button>
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
