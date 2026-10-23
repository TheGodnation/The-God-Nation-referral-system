import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError, ensureCsrfReady } from '../lib/api';
import { WhatHappens } from './MemberDeleteAccountPage';

// Public page: https://thegodnationacademy.org/delete-account — the page
// Google Play asks apps to have. Explains how to delete an account in the
// app, and lets someone ask for it here too: the email address of the
// account, then the 6-digit code sent to it. Also shown after asking in the
// app (?requested=<date>).
export function DeleteAccountPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'email' | 'code' | 'done'>(params.get('requested') ? 'done' : 'email');
  const [readyAt, setReadyAt] = useState<string | null>(params.get('requested'));
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureCsrfReady();
  }, []);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('accountDeletion.bad_email'));
    setBusy(true);
    try {
      await api.post('/api/account-deletion/request-code', { email: email.trim() });
      setStep('code');
    } catch {
      setError(t('accountDeletion.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError(t('accountDeletion.bad_code'));
    if (!understood) return setError(t('accountDeletion.need_understood'));
    setBusy(true);
    try {
      const res = await api.post<{ readyAt: string }>('/api/account-deletion/confirm', { email: email.trim(), code: code.trim() });
      setReadyAt(res.readyAt);
      setStep('done');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'BAD_CODE'
          ? t('accountDeletion.bad_code')
          : err instanceof ApiError && err.code === 'ADMIN_ACCOUNT'
            ? t('accountDeletion.admin_account')
            : t('accountDeletion.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  const date = readyAt ? new Date(readyAt).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return (
    <PageShell>
      <section className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <h1 className="text-2xl font-bold text-brand-900">{t('accountDeletion.page_title')}</h1>

        {step === 'done' ? (
          <div className="card space-y-3" role="status">
            <p className="text-lg font-semibold text-slate-800">{t('accountDeletion.done_title')}</p>
            <p className="text-slate-700">{t('accountDeletion.done_body', { date })}</p>
            <Link to="/member/login" className="btn-secondary inline-block">
              {t('accountDeletion.sign_in_to_keep')}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-slate-700">{t('accountDeletion.page_intro')}</p>
            <section className="card space-y-2">
              <h2 className="font-semibold text-brand-900">📱 {t('accountDeletion.in_app_heading')}</h2>
              <p className="text-sm text-slate-700">{t('accountDeletion.in_app_steps')}</p>
            </section>

            <WhatHappens />

            <section className="card space-y-3">
              <h2 className="font-semibold text-brand-900">✉️ {t('accountDeletion.here_heading')}</h2>
              {step === 'email' ? (
                <form onSubmit={sendCode} className="space-y-3" noValidate>
                  <label className="label" htmlFor="del-email">
                    {t('accountDeletion.email_label')}
                  </label>
                  <input id="del-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                  {error && (
                    <p role="alert" className="text-sm text-red-700">
                      {error}
                    </p>
                  )}
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {t('accountDeletion.send_code')}
                  </button>
                </form>
              ) : (
                <form onSubmit={confirm} className="space-y-3" noValidate>
                  <p className="text-sm text-slate-700">{t('accountDeletion.code_sent', { email: email.trim() })}</p>
                  <label className="label" htmlFor="del-code">
                    {t('accountDeletion.code_label')}
                  </label>
                  <input id="del-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input w-40 tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  <label className="flex items-start gap-2 text-sm text-slate-800">
                    <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                    <span>{t('accountDeletion.understood')}</span>
                  </label>
                  {error && (
                    <p role="alert" className="text-sm text-red-700">
                      {error}
                    </p>
                  )}
                  <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
                    {t('accountDeletion.submit')}
                  </button>
                  <button type="button" className="ml-3 text-sm text-slate-600 underline" onClick={() => setStep('email')}>
                    {t('accountDeletion.other_email')}
                  </button>
                </form>
              )}
            </section>
          </>
        )}
      </section>
    </PageShell>
  );
}
