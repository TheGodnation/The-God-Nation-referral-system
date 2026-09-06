import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [language, setLanguage] = useState<'en' | 'fr'>(i18n.language.startsWith('fr') ? 'fr' : 'en');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ registrationId: string; language: string }>('/api/registrations', {
        name,
        whatsapp,
        language,
      });
      navigate(`/success?id=${encodeURIComponent(res.registrationId)}&lang=${res.language}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('register.error_generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <section className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold text-brand-900">{t('register.title')}</h1>

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
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t('register.submitting') : t('register.submit')}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
