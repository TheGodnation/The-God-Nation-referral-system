import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <PageShell>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-950 to-brand-800 px-4 py-16 text-center text-white sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {t('home.hero_title')}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-brand-100 sm:text-lg">{t('home.hero_support')}</p>
          <Link to="/register" className="btn-primary mt-8 inline-flex w-full max-w-sm bg-gold-500 text-brand-950 hover:bg-gold-400 sm:w-auto">
            {t('home.hero_cta')}
          </Link>
        </div>
      </section>

      {/* About */}
      <section className="mx-auto max-w-3xl px-4 py-14 text-center">
        <h2 className="text-2xl font-bold text-brand-900">{t('home.about_title')}</h2>
        <p className="mt-4 text-slate-600">{t('home.about_body')}</p>
      </section>

      {/* Training */}
      <section className="bg-slate-50 px-4 py-14">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-brand-900">{t('home.training_title')}</h2>
          <p className="mt-4 text-slate-600">{t('home.training_body')}</p>
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-4xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold text-brand-900">{t('home.benefits_title')}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {['benefit_1', 'benefit_2', 'benefit_3', 'benefit_4'].map((key) => (
            <div key={key} className="card flex items-start gap-3">
              <span className="mt-0.5 text-gold-500">✦</span>
              <span className="text-slate-700">{t(`home.${key}`)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 px-4 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold text-brand-900">{t('home.how_title')}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {(['how_1', 'how_2', 'how_3'] as const).map((key, i) => (
              <div key={key} className="card text-center">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="font-semibold text-brand-900">{t(`home.${key}_title`)}</h3>
                <p className="mt-2 text-sm text-slate-600">{t(`home.${key}_body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-brand-900">{t('home.final_cta_title')}</h2>
        <Link to="/register" className="btn-primary mt-6 inline-flex w-full max-w-sm sm:w-auto">
          {t('home.final_cta_button')}
        </Link>
      </section>
    </PageShell>
  );
}
