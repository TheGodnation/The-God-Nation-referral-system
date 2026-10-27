import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { EventForm, formatWhen, type EventItem } from '../components/events/eventBits';
import { api } from '../lib/api';

// The calendar of the member's assemblies: what is coming, what just
// happened, and (for leaders) a way to add an event.

interface Calendar {
  upcoming: EventItem[];
  past: EventItem[];
  creatable: { id: string; name: string }[];
}

function Row({ e }: { e: EventItem }) {
  const { t, i18n } = useTranslation();
  return (
    <li>
      <Link to={`/member/events/${e.id}`} className="block px-4 py-3 no-underline hover:bg-slate-50">
        <span className="flex items-center gap-2">
          <span className={`truncate font-semibold ${e.cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{e.title}</span>
          {e.cancelled && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t('events.cancelled')}</span>}
        </span>
        <span className="block text-sm text-slate-600">
          {formatWhen(e.startsAt, i18n.language)} · {e.communityName}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {e.presence === 'LIVE' && <span className="font-semibold text-green-700">✓ {t('events.you_live')}</span>}
          {e.presence === 'REPLAY' && <span className="font-semibold text-green-700">✓ {t('events.you_replay')}</span>}
          {!e.presence && e.going && !e.cancelled && <span className="font-semibold text-brand-700">{t('events.you_going')}</span>}
          {e.goingCount > 0 && !e.cancelled && <span>{t('events.going_count', { count: e.goingCount })}</span>}
          {e.hasReplay && <span>🎧 {t('events.has_replay')}</span>}
        </span>
      </Link>
    </li>
  );
}

export function MemberEventsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [cal, setCal] = useState<Calendar | null>(null);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<Calendar>('/api/events')
      .then((r) => alive && setCal(r))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link to="/member/chats" aria-label={t('events.back') ?? ''} className="text-2xl text-brand-700 no-underline">
            ‹
          </Link>
          <h1 className="flex-1 text-2xl font-bold text-brand-900">{t('events.title')}</h1>
          {cal && cal.creatable.length > 0 && !adding && (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              {t('events.new')}
            </button>
          )}
        </div>
        {error && <p className="card text-slate-600">{t('events.failed')}</p>}
        {!error && !cal && <p className="text-sm text-slate-400">{t('events.loading')}</p>}
        {adding && cal && (
          <div className="mb-4">
            <EventForm assemblies={cal.creatable} onClose={() => setAdding(false)} onSaved={(id) => navigate(`/member/events/${id}`)} />
          </div>
        )}
        {cal && (
          <div className="space-y-4">
            <section className="card p-0">
              <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('events.upcoming')}</h2>
              {cal.upcoming.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">{t('events.none_upcoming')}</p> : <ul className="divide-y divide-slate-100">{cal.upcoming.map((e) => <Row key={e.id} e={e} />)}</ul>}
            </section>
            <section className="card p-0">
              <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('events.past')}</h2>
              {cal.past.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">{t('events.none_past')}</p> : <ul className="divide-y divide-slate-100">{cal.past.map((e) => <Row key={e.id} e={e} />)}</ul>}
            </section>
          </div>
        )}
      </section>
    </PageShell>
  );
}
