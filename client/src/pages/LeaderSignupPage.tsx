import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

// Public self-signup for Leaders — reached via a single link an Admin
// shares (along with the access phrase, out of band) in their WhatsApp
// leaders group. Creates the account, auto-generates a referral code, and
// logs the new Leader straight into their dashboard — no Admin step, no
// email round-trip. See POST /api/auth/leader-signup.
export function LeaderSignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ referralCode: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t('leaderSignup.password_too_short'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<{ referralCode: string }>('/api/auth/leader-signup', {
        name,
        email,
        password,
        phrase,
      });
      await refresh();
      setSuccess({ referralCode: res.referralCode });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('leaderSignup.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <PageShell minimal>
        <section className="mx-auto max-w-sm px-4 py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-brand-900">{t('leaderSignup.success_title')}</h1>
          <p className="mt-3 text-slate-600">{t('leaderSignup.success_code', { code: success.referralCode })}</p>
          <button type="button" className="btn-primary mt-8 w-full" onClick={() => navigate('/leader/dashboard')}>
            {t('leaderSignup.go_to_dashboard')}
          </button>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('leaderSignup.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('leaderSignup.subtitle')}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          <div>
            <label className="label" htmlFor="name">
              {t('leaderSignup.name_label')}
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
            />
          </div>

          <div>
            <label className="label" htmlFor="email">
              {t('leaderSignup.email_label')}
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

          <div>
            <label className="label" htmlFor="password">
              {t('leaderSignup.password_label')}
            </label>
            <PasswordInput id="password" value={password} onChange={setPassword} required minLength={8} autoComplete="new-password" />
          </div>

          <div>
            <label className="label" htmlFor="phrase">
              {t('leaderSignup.phrase_label')}
            </label>
            <input
              id="phrase"
              className="input"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              required
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-slate-400">{t('leaderSignup.phrase_hint')}</p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t('leaderSignup.submitting') : t('leaderSignup.submit')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/login" className="text-brand-700 hover:underline">
            {t('leaderSignup.back_to_login')}
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
