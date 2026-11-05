import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { RepresentRequestForm } from '../components/member/RepresentRequestForm';
import { api } from '../lib/api';

interface CountryRow {
  id: string;
  name: string;
  country: string;
}

/**
 * "Request to represent your area", on a page of its own: the member names their exact subdivision (or a
 * quarter within it). Arriving from "Represent this place" in the directory brings that place with it.
 */
export function MemberRepresentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [countries, setCountries] = useState<CountryRow[] | null>(null);
  const [fixedArea, setFixedArea] = useState<{ id: string; label: string } | null>(() => {
    const id = params.get('areaId');
    return id ? { id, label: params.get('label') ?? '' } : null;
  });

  useEffect(() => {
    api
      .get<{ items: CountryRow[] }>('/api/member/geographic-areas/countries')
      .then((res) => setCountries(res.items))
      .catch(() => setCountries([]));
  }, []);

  const root = countries?.[0];

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold leading-snug text-brand-900">{t('representatives.request_title')}</h1>
          <Link to="/member/representatives" className="shrink-0 pt-2 text-sm text-brand-700 underline">
            {t('leadershipDirectory.back')}
          </Link>
        </div>
        {countries !== null && (
          <RepresentRequestForm
            country={root?.country ?? ''}
            fixedArea={fixedArea}
            onClearFixedArea={() => setFixedArea(null)}
            onChanged={() => undefined}
            startOpen
            onCancel={() => navigate('/member/representatives')}
          />
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
