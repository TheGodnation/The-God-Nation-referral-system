import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';

// Section 33: redeem a one-time reset token for a new password.
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError(t('resetPassword.no_token_error'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('resetPassword.not_same'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('resetPassword.too_short'));
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/auth/reset-password', { token, newPassword });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'BAD_LINK' ? t('resetPassword.bad_link') : err instanceof ApiError && err.status === 429 ? t('resetPassword.too_many') : t('resetPassword.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('resetPassword.title')}</h1>

        {success ? (
          <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {t('resetPassword.done')}
          </p>
        ) : (
          <>
            {!token && (
              <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {t('resetPassword.no_token')}{' '}
                <Link to="/forgot-password" className="underline">
                  {t('resetPassword.request_new')}
                </Link>
              </p>
            )}
            <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
              <div>
                <label className="label" htmlFor="newPassword">
                  {t('resetPassword.new_password')}
                </label>
                <PasswordInput
                  id="newPassword"
                  value={newPassword}
                  onChange={setNewPassword}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="label" htmlFor="confirmPassword">
                  {t('resetPassword.confirm_password')}
                </label>
                <PasswordInput
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary w-full" disabled={submitting || !token}>
                {submitting ? t('resetPassword.saving') : t('resetPassword.save')}
              </button>
            </form>
          </>
        )}
      </section>
    </PageShell>
  );
}
