import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { StatusChip } from './FaithJourneyView';

// On a person's profile, for the central admin (and for leaders, when allowed):
// where this person stands with Christ and a way into their faith journey.
// Shows nothing for anyone else, or for a person who has not answered.
export function PersonFaithCard({ personId }: { personId: string }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{ exists: boolean; status: 'BORN_AGAIN' | 'NEEDS_CONVERSATION' | null; confirmed?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ exists: boolean; status: 'BORN_AGAIN' | 'NEEDS_CONVERSATION' | null; confirmed?: boolean }>(`/api/member/faith/${personId}/exists`)
      .then((r) => live && setInfo(r))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [personId]);

  if (!info?.exists) return null;
  return (
    <Link to={`/member/faith/${personId}`} className="card mx-4 flex items-center justify-between gap-3 no-underline sm:mx-0" data-testid="person-faith-card">
      <span>
        <span className="block text-sm font-semibold text-brand-900">🕊️ {t('faith.card_title')}</span>
        <span className="block text-xs text-slate-500">{t('faith.card_open')}</span>
      </span>
      <StatusChip status={info.status} confirmed={info.confirmed} />
    </Link>
  );
}
