import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { GeographicDirectory } from '../components/member/GeographicDirectory';

// The Leadership Directory — the Geographical Leadership Directory is the
// sole Leadership Directory (an earlier free-text version, which only ever
// attached a label to a profile without granting any real role, was
// retired in favor of this one). See GeographicDirectory for the directory
// itself and the "request to represent an area" form.
export function MemberLeadershipPage() {
  const { t } = useTranslation();

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('leadershipDirectory.title')}</h1>
          <Link to="/member/people" className="text-sm text-brand-700 underline">
            {t('leadershipDirectory.back')}
          </Link>
        </div>

        <GeographicDirectory />

        <MemberNav />
      </section>
    </PageShell>
  );
}
