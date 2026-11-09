import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { FaithJourneyView } from '../components/faith/FaithJourneyView';

// One person's faith journey, opened from a notification or from their profile.
// The server decides who may read it (the central admin; leaders when allowed).
export function MemberFaithPage() {
  const { t } = useTranslation();
  const { personId = '' } = useParams();
  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <Link to="/member/me" className="mb-3 inline-block text-sm text-brand-700 hover:underline">
          ← {t('faith.back_to_me')}
        </Link>
        <FaithJourneyView base="/api/member/faith" personId={personId} />
        <MemberNav />
      </section>
    </PageShell>
  );
}
