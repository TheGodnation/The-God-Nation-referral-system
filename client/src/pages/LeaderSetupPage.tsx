import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

// Section 30: secure one-time Leader setup — reached via the link emailed
// by Admin (section 27-29). Validates entirely server-side; this page just
// collects the new password and submits the token.
export function LeaderSetupPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('This setup link is missing its token. Please use the link from your invitation email.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/auth/leader-setup/complete', { token, newPassword });
      await refresh();
      navigate('/leader/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">Set Your Password</h1>
        <p className="mt-2 text-sm text-slate-500">
          Welcome! Choose a password to activate your Leader account.
        </p>

        {!token && (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            No setup token found in this link. Please use the link from your invitation email, or ask an
            Admin to resend it.
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          <div>
            <label className="label" htmlFor="newPassword">
              New Password
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
              Confirm New Password
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
            {submitting ? 'Setting up…' : 'Activate My Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/login" className="text-brand-700 hover:underline">
            Back to login
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
