import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { usePublicSettings } from '../lib/usePublicSettings';

type Pathway = 'TRAINING' | 'DISCOVER_GROW';

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { supportWhatsappUrl } = usePublicSettings();
  const whatsappInputRef = useRef<HTMLInputElement>(null);

  const pathway: Pathway = params.get('pathway') === 'DISCOVER_GROW' ? 'DISCOVER_GROW' : 'TRAINING';

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState<'en' | 'fr'>(i18n.language.startsWith('fr') ? 'fr' : 'en');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Section 20: duplicate-registration assistance only appears after an
  // actual duplicate attempt — never shown pre-emptively.
  const [duplicate, setDuplicate] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(false);
    setSubmitting(true);
    try {
      const res = await api.post<{ registrationId: string; language: string; pathway: Pathway; confirmationEmailSent: boolean }>(
        '/api/registrations',
        { name, whatsapp, language, pathway, email: email || undefined },
      );
      navigate(
        `/success?id=${encodeURIComponent(res.registrationId)}&lang=${res.language}&pathway=${res.pathway}&emailSent=${res.confirmationEmailSent}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDuplicate(true);
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('register.error_generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function tryDifferentNumber() {
    setDuplicate(false);
    setError(null);
    setWhatsapp('');
    whatsappInputRef.current?.focus();
  }

  const title = pathway === 'DISCOVER_GROW' ? t('register.title_discover') : t('register.title_training');

  return (
    <PageShell>
      <section className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold text-brand-900">{title}</h1>

        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          <div>
            <label className="label" htmlFor="name">
              {t('register.name_label')}
            </label>
            <input
              id="name"
              className="input"
              placeholder={t('register.name_placeholder') ?? ''}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
            />
          </div>

          <div>
            <label className="label" htmlFor="whatsapp">
              {t('register.whatsapp_label')}
            </label>
            <p className="mb-2 text-sm text-slate-500">{t('register.whatsapp_prompt')}</p>
            <input
              id="whatsapp"
              ref={whatsappInputRef}
              className="input"
              placeholder={t('register.whatsapp_placeholder') ?? ''}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              required
              inputMode="tel"
              autoComplete="tel"
            />
          </div>

          <div>
            <label className="label" htmlFor="email">
              {t('register.email_label')}
            </label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder={t('register.email_placeholder') ?? ''}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="label" htmlFor="language">
              {t('register.language_label')}
            </label>
            <select
              id="language"
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'fr')}
            >
              <option value="en">{t('common.language_en')}</option>
              <option value="fr">{t('common.language_fr')}</option>
            </select>
          </div>

          {error && (
            <div role="alert" className="space-y-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              <p>{error}</p>
              {duplicate && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={tryDifferentNumber} className="btn-secondary flex-1 text-xs">
                    {t('register.duplicate_try_different')}
                  </button>
                  {supportWhatsappUrl && (
                    <a
                      href={supportWhatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary flex-1 bg-green-600 text-center text-xs hover:bg-green-700"
                    >
                      {t('register.duplicate_contact_us')}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t('register.submitting') : t('register.submit')}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
