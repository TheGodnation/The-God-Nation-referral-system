import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatWhen, type EventItem } from '../events/eventBits';

// The way into the calendar, with the next event under it.
export function EventsCard() {
  const { t, i18n } = useTranslation();
  const [next, setNext] = useState<EventItem | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    api
      .get<{ upcoming: EventItem[] }>('/api/events')
      .then((r) => alive && setNext(r.upcoming.find((e) => !e.cancelled) ?? null))
      .catch(() => alive && setNext(null));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Link to="/member/events" className="card mb-4 flex items-center gap-3 no-underline">
      <span aria-hidden className="text-2xl">📅</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-brand-900">{t('events.card_title')}</span>
        <span className="block truncate text-sm text-slate-600">
          {next ? t('events.card_next', { title: next.title, when: formatWhen(next.startsAt, i18n.language) }) : next === null ? t('events.card_none') : t('events.card_sub')}
        </span>
      </span>
      <span aria-hidden className="text-brand-700">›</span>
    </Link>
  );
}
