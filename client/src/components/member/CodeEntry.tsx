import { noteSignIn } from '../../lib/accountDeletion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { useResendCooldown } from '../../lib/useResendCooldown';
import { PasswordInput } from '../PasswordInput';

// Step 2 of signing in: type the 6-digit code from the email, on the same
// screen where it was asked for. (Tapping the link in the email still works
// too, but on phones it often opens inside the email app instead of the
// browser — typing the code avoids that.)
//
// `requirePassword` is only set on the "forgot password / never set one"
// screen (reached from the sign-in page, never from signing up) — the code
// still only confirms the email, but this step also sets the account's
// password in the same request. During sign-up itself the password was
// already given on the signup form, so this stays false there.
export function CodeEntry({
  email,
  onChangeEmail,
  requirePassword,
}: {
  email: string;
  onChangeEmail?: () => void;
  requirePassword?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refresh } = useMemberAuth();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // A code was sent just before this screen appeared, so the wait starts now.
  const cooldown = useResendCooldown();

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError(t('memberCode.need_six'));
      return;
    }
    if (requirePassword && newPassword.length < 8) {
      setError(t('memberCode.password_too_short'));
      return;
    }
    setBusy(true);
    try {
      noteSignIn(await api.post('/api/member/auth/verify-code', { email, code: clean, ...(requirePassword ? { newPassword } : {}) }));
      await refresh();
      navigate('/member/chats', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'BAD_CODE' ? t('memberCode.bad_code') : t('memberCode.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown.remaining > 0) return;
    setError(null);
    setResent(false);
    cooldown.start();
    try {
      await api.post('/api/member/auth/request-code', { email });
      setResent(true);
    } catch {
      setError(t('memberCode.failed'));
    }
  }

  return (
    <form onSubmit={verify} className="mt-6 space-y-4" noValidate>
      <p className="text-sm text-slate-600">{t('memberCode.sent_to', { email })}</p>
      <div>
        <label className="label" htmlFor="member-code">
          {t('memberCode.label')}
        </label>
        <input
          id="member-code"
          className="input text-center text-2xl tracking-[0.5em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </div>
      {requirePassword && (
        <div>
          <label className="label" htmlFor="member-new-password">
            {t('memberCode.new_password_label')}
          </label>
          <PasswordInput
            id="member-new-password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={8}
          />
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      {resent && <p className="text-sm text-green-700">{t('memberCode.resent')}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? t('memberCode.checking') : t(requirePassword ? 'memberCode.submit_set_password' : 'memberCode.submit')}
      </button>
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-brand-700 underline disabled:text-slate-400 disabled:no-underline"
          onClick={resend}
          disabled={cooldown.remaining > 0}
        >
          {cooldown.remaining > 0 ? t('memberCode.resend_wait', { seconds: cooldown.remaining }) : t('memberCode.resend')}
        </button>
        {onChangeEmail && (
          <button type="button" className="text-slate-500 underline" onClick={onChangeEmail}>
            {t('memberCode.change_email')}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{t('memberCode.spam_hint')}</p>
      <p className="text-xs text-slate-500">{t('memberCode.slow_hint')}</p>
    </form>
  );
}
