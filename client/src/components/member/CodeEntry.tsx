import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useMemberAuth } from '../../lib/MemberAuthContext';

// Step 2 of signing in: type the 6-digit code from the email, on the same
// screen where it was asked for. (Tapping the link in the email still works
// too, but on phones it often opens inside the email app instead of the
// browser — typing the code avoids that.)
export function CodeEntry({ email, onChangeEmail }: { email: string; onChangeEmail?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refresh } = useMemberAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError(t('memberCode.need_six'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/member/auth/verify-code', { email, code: clean });
      await refresh();
      navigate('/member/chats', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'BAD_CODE' ? t('memberCode.bad_code') : t('memberCode.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setResent(false);
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
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      {resent && <p className="text-sm text-green-700">{t('memberCode.resent')}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? t('memberCode.checking') : t('memberCode.submit')}
      </button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-brand-700 underline" onClick={resend}>
          {t('memberCode.resend')}
        </button>
        {onChangeEmail && (
          <button type="button" className="text-slate-500 underline" onClick={onChangeEmail}>
            {t('memberCode.change_email')}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{t('memberCode.spam_hint')}</p>
    </form>
  );
}
