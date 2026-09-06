import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';

// The WhatsApp redirect is a plain top-level navigation (not a fetch) to a
// server-controlled endpoint. The browser sends the httpOnly visitor_id
// cookie automatically; the server verifies it matches Registration.visitorId,
// records WHATSAPP_CLICKED, and only then issues a 302 to the configured
// community URL. See server/src/routes/registrations.ts.
export function SuccessPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const registrationId = params.get('id');

  return (
    <PageShell minimal>
      <section className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
        <h1 className="text-2xl font-bold text-brand-900">{t('success.title')}</h1>
        <p className="mt-3 text-slate-600">{t('success.body')}</p>

        {registrationId ? (
          <a
            href={`/api/registrations/${encodeURIComponent(registrationId)}/whatsapp`}
            className="btn-primary mt-8 w-full max-w-sm bg-green-600 hover:bg-green-700"
          >
            {t('success.cta')}
          </a>
        ) : null}
      </section>
    </PageShell>
  );
}
