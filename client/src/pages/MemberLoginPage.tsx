import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';

// Phase 3C: public magic-link request. The server always returns the same
// generic response regardless of whether the WhatsApp number/email is
// recognized — this page never tries to interpret the response as
// "success" vs "not found", since there is no such distinction to make.
export function MemberLoginPage() {
  const { t } = useTranslation();
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/member/auth/request-link', { whatsapp, email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('memberLogin.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('memberLogin.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('memberLogin.subtitle')}</p>

        {sent ? (
          <div role="status" className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {t('memberLogin.sent_message')}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
            <div>
              <label className="label" htmlFor="member-whatsapp">
                {t('memberLogin.whatsapp_label')}
              </label>
              <input
                id="member-whatsapp"
                className="input"
                placeholder={t('memberLogin.whatsapp_placeholder') ?? ''}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                required
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="label" htmlFor="member-email">
                {t('memberLogin.email_label')}
              </label>
              <input
                id="member-email"
                type="email"
                className="input"
                placeholder={t('memberLogin.email_placeholder') ?? ''}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('memberLogin.submitting') : t('memberLogin.submit')}
            </button>
          </form>
        )}
      </section>
    </PageShell>
  );
}
