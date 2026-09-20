import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api } from '../lib/api';

// /join?ref=CODE&lang=en&utm_source=...&utm_medium=...&utm_campaign=...
//
// Section 8: a referral link must land on the normal official homepage —
// never a page that reveals who referred the visitor. This page's only job
// is to record the server-side ReferralVisit (which is where attribution
// actually lives, via the opaque visitor_id cookie), then silently redirect
// to "/". The visitor never sees a distinct "you were invited" screen.
export function JoinPage() {
  const { i18n, t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sentRef = useRef(false);
  const [showFallback, setShowFallback] = useState(false);

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
        // Non-fatal: the visitor still lands on the homepage even if the
        // visit could not be recorded (e.g. transient network issue).
      })
      .finally(() => {
        navigate('/', { replace: true });
        // In case navigation is somehow blocked, don't leave a spinner
        // forever — show a manual link after a moment.
        setTimeout(() => setShowFallback(true), 3000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell>
      <section className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-4 text-center">
        <p className="text-slate-500">{t('join.loading')}</p>
        {showFallback && (
          <a href="/" className="btn-primary mt-6">
            {t('common.back_home')}
          </a>
        )}
      </section>
    </PageShell>
  );
}
