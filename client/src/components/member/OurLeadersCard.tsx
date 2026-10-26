import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Avatar } from '../Avatar';

interface TeamFace {
  personId: string;
  name: string;
  photoUrl: string | null;
}

// The way into the Leadership Directory, at the top of the People page: a card
// called "Our Leaders" with a few of the National Team's faces on it.
export function OurLeadersCard() {
  const { t } = useTranslation();
  const [faces, setFaces] = useState<TeamFace[]>([]);

  useEffect(() => {
    api
      .get<{ items: TeamFace[] }>('/api/member/leadership-directory/national-team')
      .then((res) => setFaces(res.items.slice(0, 5)))
      .catch(() => setFaces([]));
  }, []);

  return (
    <Link to="/member/leadership" className="card flex items-center gap-3 no-underline">
      <span aria-hidden className="text-2xl">🧭</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-brand-900">{t('leadershipDirectory.title')}</span>
        <span className="block text-sm text-slate-600">{t('people.our_leaders_help')}</span>
      </span>
      {faces.length > 0 && (
        <span className="flex -space-x-2" aria-hidden>
          {faces.map((f) => (
            <span key={f.personId} className="rounded-full ring-2 ring-white">
              <Avatar name={f.name} photoUrl={f.photoUrl} size={32} />
            </span>
          ))}
        </span>
      )}
      <span aria-hidden className="text-brand-700">›</span>
    </Link>
  );
}
