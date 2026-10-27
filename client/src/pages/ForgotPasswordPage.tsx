import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';

// Section 33: request a reset link. The response is always the same
// generic message, regardless of whether the account exists.
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('resetPassword.too_many') : t('resetPassword.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('forgotPassword.title')}</h1>

        {submitted ? (
          <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {t('forgotPassword.sent')}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
            <div>
              <label className="label" htmlFor="email">
                {t('forgotPassword.email')}
              </label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('forgotPassword.sending') : t('forgotPassword.send')}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/login" className="text-brand-700 hover:underline">
            {t('resetPassword.back_to_login')}
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
