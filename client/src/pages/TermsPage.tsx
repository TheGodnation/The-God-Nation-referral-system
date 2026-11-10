import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { useDocumentMeta } from '../lib/useDocumentMeta';

interface Section {
  h: string;
  p: string[];
}

// Public page: https://thegodnationacademy.org/terms — the rules for using the app and the website
// (who may use it, the community rules, what happens when they are broken, content, payments).
// Written to match how the app really works; update the date and the text whenever either changes.
export function TermsPage() {
  const { t } = useTranslation();
  useDocumentMeta(t('terms.title'), t('terms.intro'));
  const sections = t('terms.sections', { returnObjects: true }) as Section[];

  return (
    <PageShell>
      <article className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <header>
          <h1 className="text-2xl font-bold text-brand-900">{t('terms.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('terms.updated')}</p>
        </header>
        <p className="text-slate-700">{t('terms.intro')}</p>
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
            {t('terms.contact_link')}
          </Link>
          <Link to="/privacy" className="btn-secondary">
            {t('terms.privacy_link')}
          </Link>
        </div>
      </article>
    </PageShell>
  );
}
