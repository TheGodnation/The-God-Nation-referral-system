import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api } from '../lib/api';

// /join?ref=CODE&lang=en&utm_source=...&utm_medium=...&utm_campaign=...
export function JoinPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const [ready, setReady] = useState(false);
  const sentRef = useRef(false);

  const ref = params.get('ref') || undefined;
  const lang = params.get('lang');

  useEffect(() => {
    if (lang === 'en' || lang === 'fr') {
      i18n.changeLanguage(lang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    api
      .post('/api/referrals/visit', {
        ref,
        lang: lang === 'fr' ? 'fr' : 'en',
        utmSource: params.get('utm_source') || undefined,
        utmMedium: params.get('utm_medium') || undefined,
        utmCampaign: params.get('utm_campaign') || undefined,
        landingPage: window.location.pathname + window.location.search,
      })
      .catch(() => {
        // Non-fatal: the visitor can still proceed to register even if the
        // visit could not be recorded (e.g. transient network issue).
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell>
      <section className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
        {!ready ? (
          <p className="text-slate-500">{t('join.loading')}</p>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-brand-900">{t('join.title')}</h1>
            <p className="mt-3 text-slate-600">{t('join.body')}</p>
            <Link to="/register" className="btn-primary mt-8 w-full max-w-sm">
              {t('join.cta')}
            </Link>
          </>
        )}
      </section>
    </PageShell>
  );
}
