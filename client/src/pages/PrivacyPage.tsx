import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { useDocumentMeta } from '../lib/useDocumentMeta';

interface Section {
  h: string;
  p: string[];
}

// Public page: https://thegodnationacademy.org/privacy — the privacy policy
// Google Play asks every app to link to. Written in plain words from what
// the app really collects and which services it uses; update the date and
// the text whenever either changes.
export function PrivacyPage() {
  const { t } = useTranslation();
  useDocumentMeta(t('privacy.title'), t('privacy.intro'));
  const sections = t('privacy.sections', { returnObjects: true }) as Section[];

  return (
    <PageShell>
      <article className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <header>
          <h1 className="text-2xl font-bold text-brand-900">{t('privacy.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('privacy.updated')}</p>
        </header>
        <p className="text-slate-700">{t('privacy.intro')}</p>
        {sections.map((s) => (
          <section key={s.h} className="space-y-2">
            <h2 className="text-lg font-semibold text-brand-900">{s.h}</h2>
            {s.p.map((line) => (
              <p key={line} className="text-slate-700">
                {line}
              </p>
            ))}
          </section>
        ))}
        <div className="flex flex-wrap gap-3 pt-2">
          <Link to="/contact" className="btn-primary">
            {t('privacy.contact_link')}
          </Link>
          <Link to="/delete-account" className="btn-secondary">
            {t('privacy.delete_link')}
          </Link>
        </div>
      </article>
    </PageShell>
  );
}
