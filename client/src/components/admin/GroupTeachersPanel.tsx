import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Row {
  id: string;
  personId: string;
  name: string;
  language: 'en' | 'fr';
  communityId: string;
  communityName: string;
  days: { id: string; dayOfWeek: number | null; date: string | null; time: string }[];
}
interface Member {
  id: string;
  name: string;
  language: 'en' | 'fr';
  hasAccount: boolean;
}
interface Group {
  id: string;
  name: string;
}

const BASE = '/api/member/central-teachers';

// Teachers who teach with the central admin: choose a member and a group, then set their teaching days (every week, or one date).
function Picker<T extends { id: string; name: string }>({ label, placeholder, find, onPick, picked, testId }: { label: string; placeholder: string; find: (q: string) => Promise<T[]>; onPick: (v: T | null) => void; picked: T | null; testId: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<T[]>([]);
  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const id = window.setTimeout(() => void find(q).then((r) => alive && setResults(r)).catch(() => alive && setResults([])), 250);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [q, picked, find]);
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700">{label}</label>
      {picked ? (
        <p className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900" data-testid={`${testId}-picked`}>
          <span className="font-semibold">{picked.name}</span>
          <button type="button" className="text-xs underline" onClick={() => { onPick(null); setQ(''); }}>×</button>
        </p>
      ) : (
        <>
          <input className="input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} data-testid={`${testId}-input`} />
          {results.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onPick(r)} data-testid={`${testId}-result`}>{r.name}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function DayForm({ onAdd, busy }: { onAdd: (input: { dayOfWeek?: number; date?: string; time: string }) => void; busy: boolean }) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<'weekly' | 'date'>('weekly');
  const [weekday, setWeekday] = useState(3);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('07:00');
  const names = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'long' }).format(new Date(2024, 0, i + 1))), [i18n.language]);
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-2" data-testid="day-form">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group">
        {(['weekly', 'date'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`px-3 py-1.5 text-xs font-semibold ${kind === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700'}`} data-testid={`day-kind-${k}`}>
            {k === 'weekly' ? t('groupTeachers.every_week') : t('groupTeachers.one_date')}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'weekly' ? (
          <select className="input" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label={t('groupTeachers.weekday') ?? ''} data-testid="day-weekday">
            {names.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
          </select>
        ) : (
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('groupTeachers.date') ?? ''} data-testid="day-date" />
        )}
        <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('groupTeachers.start_time') ?? ''} data-testid="day-time" />
        <button type="button" className="btn-secondary" disabled={busy || !time || (kind === 'date' && !date)} onClick={() => onAdd(kind === 'weekly' ? { dayOfWeek: weekday, time } : { date, time })} data-testid="day-add">{t('groupTeachers.add_day')}</button>
      </div>
      <p className="text-xs text-slate-500">{t('teachingRota.cameroon_time')}</p>
    </div>
  );
}

export function GroupTeachersPanel() {
  const { t, i18n } = useTranslation();
  const [teachers, setTeachers] = useState<Row[] | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fr = i18n.language.startsWith('fr');

  useEffect(() => {
    api.get<{ teachers: Row[] }>(BASE).then((r) => setTeachers(r.teachers)).catch(() => setError(t('groupTeachers.load_failed')));
  }, [t]);

  async function run(fn: () => Promise<{ teachers: Row[] }>, after?: () => void) {
    setBusy(true);
    setError('');
    try {
      setTeachers((await fn()).teachers);
      after?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('groupTeachers.failed'));
    } finally {
      setBusy(false);
    }
  }
  const findMembers = useMemo(() => async (q: string) => (await api.get<{ items: Member[] }>(`${BASE}/members?search=${encodeURIComponent(q)}`)).items.filter((m) => m.hasAccount), []);
  const findGroups = useMemo(() => async (q: string) => (await api.get<{ items: Group[] }>(`${BASE}/groups?search=${encodeURIComponent(q)}`)).items, []);
  const dayText = (d: Row['days'][number]) => {
    const weekday = d.dayOfWeek ? new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { weekday: 'long' }).format(new Date(2024, 0, d.dayOfWeek)) : '';
    return d.dayOfWeek ? t('groupTeachers.weekly_text', { day: weekday, time: d.time }) : t('groupTeachers.date_text', { date: new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d.date}T12:00:00Z`)), time: d.time });
  };
  const byGroup = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of teachers ?? []) m.set(r.communityName, [...(m.get(r.communityName) ?? []), r]);
    return [...m.entries()];
  }, [teachers]);

  return (
    <div className="space-y-4" data-testid="group-teachers-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('groupTeachers.title')}</h2>
        <p className="text-sm text-slate-600">{t('groupTeachers.intro')}</p>
      </div>

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">{t('groupTeachers.add_title')}</h3>
        <Picker<Member> label={t('groupTeachers.member') ?? ''} placeholder={t('groupTeachers.member_ph') ?? ''} find={findMembers} onPick={setMember} picked={member} testId="gt-member" />
        <Picker<Group> label={t('groupTeachers.group') ?? ''} placeholder={t('groupTeachers.group_ph') ?? ''} find={findGroups} onPick={setGroup} picked={group} testId="gt-group" />
        <button type="button" className="btn-primary w-full" disabled={busy || !member || !group} onClick={() => void run(() => api.post<{ teachers: Row[] }>(BASE, { personId: member!.id, communityId: group!.id }), () => { setMember(null); setGroup(null); })} data-testid="gt-add">
          {t('groupTeachers.add')}
        </button>
        <p className="text-xs text-slate-500">{t('groupTeachers.add_help')}</p>
      </section>

      {teachers && teachers.length === 0 && <p className="card text-sm text-slate-600" data-testid="gt-empty">{t('groupTeachers.none')}</p>}
      {byGroup.map(([groupName, rows]) => (
        <section key={groupName} className="space-y-2" data-testid="gt-group">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{groupName}</h3>
          {rows.map((r) => (
            <div key={r.id} className="card space-y-2" data-testid={`gt-row-${r.id}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-brand-900">{r.name}</p>
                <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={busy} onClick={() => { if (window.confirm(t('groupTeachers.confirm_remove', { name: r.name, group: r.communityName }) ?? '')) void run(() => api.delete<{ teachers: Row[] }>(`${BASE}/${r.id}`)); }} data-testid="gt-remove">
                  {t('groupTeachers.remove')}
                </button>
              </div>
              {r.days.length === 0 && <p className="text-sm text-slate-500">{t('groupTeachers.no_days')}</p>}
              <ul className="space-y-1">
                {r.days.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm" data-testid="gt-day">
                    <span>{dayText(d)}</span>
                    <button type="button" className="text-xs text-red-700 underline" disabled={busy} onClick={() => void run(() => api.delete<{ teachers: Row[] }>(`${BASE}/days/${d.id}`))}>×</button>
                  </li>
                ))}
              </ul>
              <DayForm busy={busy} onAdd={(input) => void run(() => api.post<{ teachers: Row[] }>(`${BASE}/${r.id}/days`, input))} />
            </div>
          ))}
        </section>
      ))}
      {error && <p role="alert" className="text-sm text-red-700" data-testid="gt-error">{error}</p>}
    </div>
  );
}
