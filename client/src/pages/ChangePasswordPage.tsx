import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

// Shown when the authenticated user's account has mustChangePassword=true
// (Admin bootstrap, newly created Leaders) — ProtectedRoute redirects here
// until the password is changed. Also reachable at any time to change a
// password voluntarily.
export function ChangePasswordPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      await refresh();
      navigate(user?.role === 'ADMIN' ? '/admin/dashboard' : '/leader/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">Change Password</h1>
        {user?.mustChangePassword && (
          <p className="mt-2 text-sm text-slate-500">
            For security, you must set a new password before continuing.
          </p>
        )}
        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          <div>
            <label className="label" htmlFor="currentPassword">
              Current Password
            </label>
            <input
              id="currentPassword"
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label" htmlFor="newPassword">
              New Password
            </label>
            <input
              id="newPassword"
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save New Password'}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
