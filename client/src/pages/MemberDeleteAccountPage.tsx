import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { deleteAllFor } from '../lib/offlineStore';

// "Delete my account" in the app (Me → Edit profile). Says plainly that
// everything will be lost, asks for the password and an "I understand",
// then signs the member out. The account is hidden for a month — signing
// in again brings it back — and the central admin deletes it after that.
export function MemberDeleteAccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { member, refresh } = useMemberAuth();
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!understood) return setError(t('accountDeletion.need_understood'));
    setBusy(true);
    try {
      const res = await api.post<{ readyAt: string }>('/api/member/account/delete', { password: password || undefined, confirm: true });
      // Nothing of theirs stays on this phone.
      if (member?.personId) await deleteAllFor(member.personId);
      try {
        localStorage.removeItem('member:last');
      } catch {
        // Fine.
      }
      navigate(`/delete-account?requested=${encodeURIComponent(res.readyAt)}`, { replace: true });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'WRONG_PASSWORD'
          ? t('accountDeletion.wrong_password')
          : err instanceof ApiError && err.code === 'ADMIN_ACCOUNT'
            ? t('accountDeletion.admin_account')
            : t('accountDeletion.failed'),
      );
      setBusy(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <Link to="/member/me/edit" className="text-sm text-brand-700 hover:underline">
          ← {t('accountDeletion.back')}
        </Link>
        <h1 className="text-2xl font-bold text-red-800">{t('accountDeletion.title')}</h1>
        <WhatHappens />
        <form onSubmit={submit} className="card space-y-3" noValidate>
          <label className="label" htmlFor="delete-password">
            {t('accountDeletion.password')}
          </label>
          <input id="delete-password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>{t('accountDeletion.understood')}</span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
            {t('accountDeletion.submit')}
          </button>
          <Link to="/member/me" className="block text-center text-sm text-slate-600 underline">
            {t('accountDeletion.keep')}
          </Link>
        </form>
      </section>
    </PageShell>
  );
}

/** What is lost, what is kept, and the month to change one's mind (also on the public page). */
export function WhatHappens() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">⚠️ {t('accountDeletion.lost_heading')}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('accountDeletion.lost_profile')}</li>
          <li>{t('accountDeletion.lost_messages')}</li>
          <li>{t('accountDeletion.lost_groups')}</li>
          <li>{t('accountDeletion.lost_posts')}</li>
          <li>{t('accountDeletion.lost_training')}</li>
          <li>{t('accountDeletion.lost_leader')}</li>
        </ul>
      </div>
      <p className="text-sm text-slate-700">{t('accountDeletion.kept')}</p>
      <p className="text-sm text-slate-700">{t('accountDeletion.month')}</p>
    </div>
  );
}
