import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface Item {
  name: string;
  startsAt: string;
  passed: boolean;
}

// A small line at the top of a group chat: who teaches here today, and at what time (Cameroon time). Nothing shows on days without one.
export function TeachingTodayStrip({ communityId }: { communityId: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .get<{ items: Item[] }>(`/api/communities/${communityId}/conversation/teaching-today`)
      .then((r) => alive && setItems(Array.isArray(r?.items) ? r.items : []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [communityId]);
  if (items.length === 0) return null;
  const time = (iso: string) => new Intl.DateTimeFormat(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Douala' }).format(new Date(iso));
  return (
    <div className="border-b border-brand-100 bg-brand-50 px-4 py-2 text-sm text-brand-900" data-testid="teaching-today">
      <span className="font-semibold">🎓 {t('teachingToday.title')}</span>{' '}
      {items.map((i, idx) => (
        <span key={`${i.name}-${i.startsAt}`}>
          {idx > 0 && ' · '}
          {i.name} {t('teachingToday.at', { time: time(i.startsAt) })}
          {i.passed ? ` (${t('teachingToday.earlier')})` : ''}
        </span>
      ))}{' '}
      <span className="text-brand-700">({t('teachingRota.cameroon_time')})</span>
    </div>
  );
}
