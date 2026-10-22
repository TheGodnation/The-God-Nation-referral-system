import { noteSignIn } from '../lib/accountDeletion';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';

// "Help them sign in": the private link the central admin sent on WhatsApp.
// The member chooses a new password and is signed in. Unlike the emailed
// sign-in link, nothing happens on opening it (WhatsApp's link preview opens
// links too) — only pressing the button uses it up.
export function MemberPasswordHelpPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { refresh } = useMemberAuth();

  const [status, setStatus] = useState<'checking' | 'ready' | 'done' | 'bad'>('checking');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('bad');
      return;
    }
    api
      .get<{ name: string; email: string }>(`/api/member/auth/password-help?token=${encodeURIComponent(token)}`)
      .then((res) => {
        setName(res.name);
        setEmail(res.email);
        setStatus('ready');
      })
      .catch(() => setStatus('bad'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 8) return setError(t('passwordHelp.too_short'));
    if (password !== again) return setError(t('passwordHelp.not_same'));
    setBusy(true);
    try {
      noteSignIn(await api.post('/api/member/auth/password-help', { token, newPassword: password }));
      await refresh();
      setStatus('done');
      setTimeout(() => navigate('/member/chats'), 1500);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BAD_LINK') setStatus('bad');
      else setError(err instanceof ApiError ? err.message : t('passwordHelp.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-center text-2xl font-bold text-brand-900">{t('passwordHelp.title')}</h1>

        {status === 'checking' && <p className="mt-6 text-center text-slate-500">{t('passwordHelp.checking')}</p>}

        {status === 'bad' && (
          <div className="mt-6 space-y-3 text-center">
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {t('passwordHelp.bad_link')}
            </p>
            <Link to="/member/login" className="btn-primary inline-flex w-full">
              {t('passwordHelp.go_sign_in')}
            </Link>
          </div>
        )}

        {status === 'done' && (
          <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800">
            {t('passwordHelp.done', { email })}
          </p>
        )}

        {status === 'ready' && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-slate-600">{t('passwordHelp.intro', { name, email })}</p>
            <div>
              <label className="label" htmlFor="help-new-password">
                {t('passwordHelp.new_password')}
              </label>
              <PasswordInput id="help-new-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} required />
              <p className="mt-1 text-xs text-slate-500">{t('passwordHelp.rule')}</p>
            </div>
            <div>
              <label className="label" htmlFor="help-new-password-again">
                {t('passwordHelp.again')}
              </label>
              <PasswordInput id="help-new-password-again" value={again} onChange={setAgain} autoComplete="new-password" minLength={8} required />
            </div>
            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('passwordHelp.saving') : t('passwordHelp.save')}
            </button>
          </form>
        )}
      </section>
    </PageShell>
  );
}
