import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { Avatar } from '../components/Avatar';
import { EventForm, formatWhen } from '../components/events/eventBits';
import { api, ApiError } from '../lib/api';

// One event: details, "I will come", "I'm here" with the code, the recording
// for those who could not come — and, for leaders, the code and the sheet.

interface EventDetail {
  id: string;
  communityId: string;
  communityName: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  onlineUrl: string | null;
  cancelled: boolean;
  going: boolean;
  goingCount: number;
  window: { opensAt: string; closesAt: string; open: boolean };
  mine: { live: 'LEADER' | 'SELF' | null; replayDone: boolean };
  replay: { teachingId: string; title: string; mediaKind: string | null } | null;
  canManage: boolean;
  checkInCode?: string;
  presentCount?: number;
}

interface SheetRow {
  personId: string;
  name: string;
  photoUrl: string | null;
  going: boolean;
  live: 'LEADER' | 'SELF' | null;
  replay: boolean;
  present: boolean;
}
interface Sheet {
  totals: { members: number; going: number; present: number; live: number; replay: number };
  items: SheetRow[];
}
interface Summary {
  total: number;
  items: { personId: string; name: string; photoUrl: string | null; present: number }[];
}

function CheckIn({ event, onDone }: { event: EventDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/events/${event.id}/check-in`, { code });
      onDone();
    } catch (err) {
      const c = err instanceof ApiError ? err.code : undefined;
      setError(c && ['NOT_OPEN_YET', 'CLOSED', 'WRONG_CODE', 'CANCELLED', 'NOT_MEMBER'].includes(c) ? t(`events.err_${c}`) : t('events.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <h2 className="font-semibold text-brand-900">{t('events.here_title')}</h2>
      <p className="text-sm text-slate-600">{t('events.here_help')}</p>
      <div className="flex gap-2">
        <input
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoComplete="off"
          aria-label={t('events.here_code') ?? ''}
          placeholder="0000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-widest"
        />
        <button type="submit" disabled={busy || code.length !== 4} className="btn-primary">
          {t('events.here_send')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}

function LeaderPanel({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetError, setSheetError] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const loadSheet = useCallback(() => {
    api
      .get<Sheet>(`/api/events/${event.id}/attendance`)
      .then(setSheet)
      .catch(() => setSheetError(true));
  }, [event.id]);
  useEffect(loadSheet, [loadSheet]);

  async function mark(personId: string, present: boolean) {
    await api.put(`/api/events/${event.id}/attendance/${personId}`, { present });
    loadSheet();
    onChanged();
  }

  async function toggleSummary() {
    const next = !showSummary;
    setShowSummary(next);
    if (next && !summary) {
      try {
        setSummary(await api.get<Summary>(`/api/events/summary?communityId=${encodeURIComponent(event.communityId)}&last=10`));
      } catch {
        setSummary({ total: 0, items: [] });
      }
    }
  }

  return (
    <section className="card space-y-3 border-gold-400">
      <h2 className="font-semibold text-brand-900">{t('events.leader_title')}</h2>
      <div>
        <p className="text-sm font-medium text-slate-700">{t('events.code_label')}</p>
        <p className="text-3xl font-bold tracking-[0.3em] text-brand-900" data-testid="check-in-code">
          {event.checkInCode}
        </p>
        <p className="text-xs text-slate-500">{t('events.code_help')}</p>
      </div>
      {sheet && <p className="text-sm font-semibold text-slate-700">{t('events.present_count', { present: sheet.totals.present, going: sheet.totals.going, members: sheet.totals.members })}</p>}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('events.sheet')}</h3>
        {sheetError && <p className="text-sm text-red-700">{t('events.sheet_failed')}</p>}
        {!sheet && !sheetError && <p className="text-sm text-slate-400">{t('events.sheet_loading')}</p>}
        {sheet && (
          <ul className="divide-y divide-slate-100">
            {sheet.items.map((r) => (
              <li key={r.personId} className="flex items-center gap-3 py-2">
                <Avatar name={r.name} photoUrl={r.photoUrl} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                  <span className="block text-xs text-slate-500">
                    {r.live && <span className="mr-2 text-green-700">✓ {t('events.tag_live')}</span>}
                    {!r.live && r.replay && <span className="mr-2 text-green-700">✓ {t('events.tag_replay')}</span>}
                    {r.going && !r.present && <span>{t('events.tag_going')}</span>}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  aria-label={`${r.live ? t('events.untick') : t('events.tick')}: ${r.name}`}
                  onClick={() => void mark(r.personId, !r.live)}
                >
                  {r.live ? '✓' : '○'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => void toggleSummary()}>
          {showSummary ? t('events.summary_hide') : t('events.summary_show')}
        </button>
        {showSummary && summary && (
          <div className="mt-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('events.summary_title')}</h3>
            {summary.total === 0 ? (
              <p className="text-sm text-slate-500">{t('events.summary_none')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {summary.items.map((m) => (
                  <li key={m.personId} className="flex items-center gap-3 py-1.5 text-sm">
                    <Avatar name={m.name} photoUrl={m.photoUrl} size={28} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="text-slate-600">{t('events.summary_line', { present: m.present, total: summary.total })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function MemberEventPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<EventDetail>(`/api/events/${id}`)
      .then(setEvent)
      .catch(() => setMissing(true));
  }, [id]);
  useEffect(load, [load]);

  async function setGoing(going: boolean) {
    try {
      if (going) await api.put(`/api/events/${id}/rsvp`);
      else await api.delete(`/api/events/${id}/rsvp`);
      setMessage(going ? t('events.rsvp_done') : null);
      load();
    } catch (err) {
      const c = err instanceof ApiError ? err.code : undefined;
      setMessage(c === 'CANCELLED' ? t('events.err_CANCELLED') : t('events.save_failed'));
    }
  }

  async function cancelEvent() {
    if (!window.confirm(t('events.cancel_confirm'))) return;
    try {
      await api.post(`/api/events/${id}/cancel`);
      load();
    } catch {
      setMessage(t('events.cancel_failed'));
    }
  }

  const present = event && (event.mine.live || event.mine.replayDone);
  const over = event ? new Date(event.endsAt).getTime() < Date.now() : false;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link to="/member/events" aria-label={t('events.back') ?? ''} className="text-2xl text-brand-700 no-underline">
            ‹
          </Link>
          <h1 className="text-2xl font-bold text-brand-900">{event?.title ?? t('events.title')}</h1>
        </div>
        {missing && <p className="card text-slate-600">{t('events.not_found')}</p>}
        {!missing && !event && <p className="text-sm text-slate-400">{t('events.loading')}</p>}
        {event && editing && (
          <EventForm
            assemblies={[]}
            initial={{ id: event.id, communityId: event.communityId, title: event.title, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt, location: event.location, onlineUrl: event.onlineUrl, replayTeachingId: event.replay?.teachingId ?? null }}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              load();
            }}
          />
        )}
        {event && !editing && (
          <div className="space-y-4">
            <div className="card space-y-2">
              {event.cancelled && <p className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">{t('events.cancelled_note')}</p>}
              <p className="text-sm text-slate-500">{event.communityName}</p>
              <p>
                <span className="font-semibold">{t('events.when')}: </span>
                {formatWhen(event.startsAt, i18n.language)}
              </p>
              {event.location && (
                <p>
                  <span className="font-semibold">{t('events.where')}: </span>
                  {event.location}
                </p>
              )}
              {event.onlineUrl && (
                <p>
                  <a href={event.onlineUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">
                    🔗 {t('events.online')}
                  </a>
                </p>
              )}
              {event.description && <p className="whitespace-pre-wrap text-slate-700">{event.description}</p>}
              {!event.cancelled && event.goingCount > 0 && <p className="text-sm text-slate-500">{t('events.going_count', { count: event.goingCount })}</p>}
              {event.canManage && !event.cancelled && (
                <div className="flex gap-2 pt-1">
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setEditing(true)}>
                    {t('events.edit')}
                  </button>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm text-red-700" onClick={() => void cancelEvent()}>
                    {t('events.cancel_event')}
                  </button>
                </div>
              )}
            </div>

            {present && (
              <p className="card font-semibold text-green-700" role="status">
                ✓ {event.mine.live ? t('events.live_done') : t('events.replay_done')}
              </p>
            )}

            {!event.cancelled && !over && (
              <div className="card flex flex-wrap items-center gap-3">
                {event.going ? (
                  <>
                    <span className="font-semibold text-brand-700">✓ {t('events.you_going')}</span>
                    <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => void setGoing(false)}>
                      {t('events.rsvp_no')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => void setGoing(true)}>
                    {t('events.rsvp_yes')}
                  </button>
                )}
                {message && <span className="text-sm text-slate-600">{message}</span>}
              </div>
            )}

            {!event.cancelled && !event.mine.live && (event.window.open ? <CheckIn event={event} onDone={load} /> : !over && <p className="text-sm text-slate-500">{t('events.not_open')}</p>)}

            {event.replay && !event.cancelled && (
              <div className="card space-y-1">
                <h2 className="font-semibold text-brand-900">{t('events.replay_title')}</h2>
                <p className="text-sm text-slate-600">{t('events.replay_help')}</p>
                <Link to={`/member/teachings/${event.replay.teachingId}`} className="font-semibold text-brand-700 underline">
                  🎧 {t('events.replay_open', { title: event.replay.title })}
                </Link>
              </div>
            )}

            {event.canManage && <LeaderPanel event={event} onChanged={load} />}
          </div>
        )}
      </section>
    </PageShell>
  );
}
