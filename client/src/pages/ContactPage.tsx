import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { api, ApiError } from '../lib/api';

// Public Contact form (Section 10). Reuses the existing email
// infrastructure server-side; the recipient is never client-controlled.
// A hidden honeypot field (`website`) provides basic spam protection
// without a CAPTCHA, per the instruction not to overengineer this.
export function ContactPage() {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useDocumentMeta(t('contact.title'), t('contact.subtitle'));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/contact', {
        name,
        email,
        message,
        language: i18n.language.startsWith('fr') ? 'fr' : 'en',
        website,
      });
      setSent(true);
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contact.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <section className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold text-brand-900">{t('contact.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('contact.subtitle')}</p>

        {sent ? (
          <div role="status" className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {t('contact.success')}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
            {/* Honeypot — never seen by a real visitor; kept out of the
                document flow but not display:none, which some bots skip. */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="contact-name">
                {t('contact.name_label')}
              </label>
              <input
                id="contact-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label" htmlFor="contact-email">
                {t('contact.email_label')}
              </label>
              <input
                id="contact-email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label" htmlFor="contact-message">
                {t('contact.message_label')}
              </label>
              <textarea
                id="contact-message"
                className="input"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength={5000}
              />
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('contact.submitting') : t('contact.submit')}
            </button>
          </form>
        )}
      </section>
    </PageShell>
  );
}
