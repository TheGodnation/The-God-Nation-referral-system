import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Avatar } from '../Avatar';

interface PhotoMember {
  personId: string;
  name: string;
  photoUrl: string | null;
}

// Home page member slider: a horizontally scrollable row of members who have
// a profile photo. Tapping one opens their profile. Deliberately a single
// light request (see GET /api/member/people/with-photo) with no further
// loading as the member scrolls — this is a discovery strip, not a feed.
export function MemberPhotoSlider() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<PhotoMember[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: PhotoMember[] }>('/api/member/people/with-photo')
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, []);

  if (items === null || items.length === 0) return null;

  return (
    <div className="bg-white py-3 sm:rounded-xl sm:shadow-sm">
      <h2 className="px-4 pb-2 text-sm font-semibold text-slate-500">{t('memberHome.member_slider_title')}</h2>
      <div className="flex gap-4 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
        {items.map((m) => (
          <button
            key={m.personId}
            type="button"
            className="flex w-16 shrink-0 flex-col items-center gap-1"
            onClick={() => navigate(`/member/people/${m.personId}`)}
          >
            <Avatar name={m.name} photoUrl={m.photoUrl} size={56} />
            <span className="w-full truncate text-center text-xs text-slate-600">{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
