import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { PortraitCard } from '../PortraitCard';

interface StripMember {
  personId: string;
  name: string;
  photoUrl: string | null;
}

// Home page strip: a horizontally scrollable row of people, everyone alike
// (members and leaders are not told apart). Those with a profile picture come
// first as tall picture cards, then the others as cards with their initials;
// the last card opens the People page. Tapping a card opens that profile.
// One light request (GET /api/member/people/strip), no further loading while
// scrolling — this is a discovery strip, not a feed.
export function MemberPhotoSlider() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<StripMember[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: StripMember[] }>('/api/member/people/strip')
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, []);

  if (items === null || items.length === 0) return null;

  return (
    <div className="bg-white py-3 sm:rounded-xl sm:shadow-sm">
      <h2 className="px-4 pb-2 text-sm font-semibold text-slate-500">{t('memberHome.member_slider_title')}</h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
        {items.map((m) => (
          <PortraitCard key={m.personId} name={m.name} photoUrl={m.photoUrl} onClick={() => navigate(`/member/people/${m.personId}`)} />
        ))}
        <Link
          to="/member/people"
          className="flex aspect-[4/5] w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-brand-50 text-center text-sm font-semibold text-brand-700"
        >
          <span aria-hidden className="text-2xl">›</span>
          {t('memberHome.see_everyone')}
        </Link>
      </div>
    </div>
  );
}
