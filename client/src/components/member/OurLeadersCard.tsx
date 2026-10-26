import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Avatar } from '../Avatar';

interface Face {
  personId: string;
  name: string;
  photoUrl: string | null;
}

// The way into the Leadership Directory, at the top of the People page: a card
// called "Our Leaders" with a few faces on it (the National Team, then people
// appointed to represent a place), and — always — a clear button to ask to
// represent your own area, even before anyone has been appointed.
export function OurLeadersCard() {
  const { t } = useTranslation();
  const [faces, setFaces] = useState<Face[]>([]);

  useEffect(() => {
    api
      .get<{ items: Face[] }>('/api/member/leadership-directory/faces')
      .then((res) => setFaces(res.items.slice(0, 5)))
      .catch(() => setFaces([]));
  }, []);

  return (
    <section className="card space-y-2.5 py-3" aria-labelledby="our-leaders-title">
      <Link to="/member/leadership" className="flex items-center gap-3 no-underline">
        <span aria-hidden className="text-2xl">🧭</span>
        <span className="min-w-0 flex-1">
          <span id="our-leaders-title" className="block font-semibold text-brand-900">{t('leadershipDirectory.title')}</span>
          <span className="block truncate text-sm text-slate-600">{faces.length > 0 ? t('people.our_leaders_help') : t('people.our_leaders_none')}</span>
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
      <Link
        to="/member/leadership#represent"
        className="flex items-center justify-center gap-2 rounded-xl bg-gold-400 px-3 py-2 text-sm font-semibold text-brand-950 no-underline hover:bg-gold-500"
      >
        <span aria-hidden>🙋</span>
        {t('people.represent_button')}
      </Link>
    </section>
  );
}
