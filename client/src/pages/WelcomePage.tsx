import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { usePublicSettings } from '../lib/usePublicSettings';
import { api } from '../lib/api';
import { SunriseIcon } from '../components/Icons';

// /welcome?ref=CODE&lang=en — the outreach entry point Leaders share
// directly (e.g. an evangelism WhatsApp message), as opposed to their
// regular homepage link. Unlike JoinPage (which silently records the visit
// then redirects to "/"), this page IS the destination: it records the
// same ReferralVisit for attribution, but then shows its own brief,
// first-contact message rather than the two-pathway homepage. Registering
// from here still leads into the exact same Training WhatsApp community as
// the homepage's Training pathway — one community, multiple doors in.
export function WelcomePage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const sentRef = useRef(false);
  const { content, loaded } = usePublicSettings();

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
        // Non-fatal: the visitor still sees this page even if the visit
        // could not be recorded (e.g. transient network issue).
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lng = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const c = (key: string): string | undefined => content[`welcome${key}${lng}`] || undefined;

  if (!loaded) {
    return (
      <PageShell>
        <div className="px-4 py-24 text-center text-slate-400">{t('join.loading')}</div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-950 to-brand-800 px-4 py-16 text-center text-white sm:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-gold-400/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-2xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-400">
            <SunriseIcon className="h-7 w-7" />
          </div>
          <span className="mb-3 block text-xs font-bold uppercase tracking-[0.14em] text-gold-400">
            {c('Eyebrow') || t('welcome.eyebrow')}
          </span>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {c('Title') || t('welcome.title')}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-brand-100 sm:text-lg">
            {c('Body') || t('welcome.body')}
          </p>
          <p className="mx-auto mt-4 max-w-xl text-base text-brand-100 sm:text-lg">
            {c('Body2') || t('welcome.body2')}
          </p>
          <p className="mx-auto mt-6 max-w-xl text-sm font-semibold uppercase tracking-wide text-gold-400">
            {c('Supporting') || t('welcome.supporting')}
          </p>
          <Link
            to="/register?pathway=TRAINING"
            className="btn-primary mt-8 inline-flex w-full max-w-sm bg-gold-500 text-brand-950 hover:bg-gold-400 sm:w-auto"
          >
            {c('Cta') || t('welcome.cta')}
          </Link>
          <p className="mx-auto mt-4 max-w-sm text-xs text-brand-200">
            {c('SupportNote') || t('welcome.support_note')}
          </p>
        </div>
      </section>
    </PageShell>
  );
}
