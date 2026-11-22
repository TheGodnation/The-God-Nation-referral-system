import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import type { TeachingView } from '../teaching/teachingTypes';
import { TeachingTopicView } from '../teaching/TeachingTopicView';
import { TeachingPageBody } from '../../pages/MemberMyTeachingPage';
import { TeachingTopicEditor } from './TeachingTopicEditor';
import { dayName, type LevelCounts, type TopicText } from '../teaching/teachingTypes';
import { CountChips } from '../teaching/TeachingRatings';

interface Upcoming { weekStart: string; number: number; title: string }
interface TeacherRow {
  id: string;
  name: string;
  active: boolean;
  personId: string | null;
  memberName: string | null;
  hasAccount: boolean;
  language: 'en' | 'fr' | null;
  dayOfWeek: number;
  startTime: string;
  startTopic: number;
  upcoming: Upcoming[];
  ratings: { total: number; average: number | null; counts: LevelCounts };
  /** What happened to this week's assignment (null = not sent yet). */
  assignment: { sentAt: string; messageSent: boolean; conversationId: string | null; seen: boolean; replied: boolean } | null;
  /** The recording made ahead of time for this week (null = none yet). */
  recording: 'RECORDED' | 'WRITING' | 'TEXT_READY' | 'FAILED' | 'APPROVED' | 'POSTED' | null;
}
interface SendResult { sent: number; alreadySent: number; sentTo: string[]; passed: string[]; notMatched: string[]; overview: Overview }
interface RatingDetail { name: string; weeks: { weekStart: string; topic: string; total: number; average: number | null; counts: LevelCounts; raters: { name: string; level: string }[] }[] }
interface GroupFound { id: string; name: string }
interface Overview {
  settings: { enabled: boolean; startDate: string; frenchChecked: boolean; started: boolean } | null;
  raters: { communityId: string | null; communityName: string | null; count: number };
  weeks: string[];
  topics: { number: number; kind: string; title: string; hasFrench: boolean; hasBook?: boolean }[];
  teachers: TeacherRow[];
  warnings: string[];
  frenchNeeded: boolean;
}
interface Found { id: string; name: string; language: 'en' | 'fr'; hasAccount: boolean; takenBy: string | null }
interface MatchResult { matched: number; ambiguous: string[]; notFound: string[] }

// FileReader works on every phone browser (Blob.text() is missing on a few older ones).
const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });

const WARNING_KEYS: Record<string, string> = {
  NO_PLAN: 'teachingRota.w_no_plan',
  UNMATCHED: 'teachingRota.w_unmatched',
  MORE_TEACHERS_THAN_TOPICS: 'teachingRota.w_more_teachers',
  SAME_SLOT: 'teachingRota.w_same_slot',
  FRENCH_MISSING: 'teachingRota.w_french_missing',
  NO_RATING_GROUP: 'teachingRota.w_no_rating_group',
  BOOK_MISSING: 'teachingRota.w_book_missing',
};

function MemberPicker({ base, onPick }: { base: string; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Found[]>([]);
  const [hint, setHint] = useState('');
  const [note, setNote] = useState<'PARTIAL' | 'ERASED' | null>(null);
  useEffect(() => {
    setHint('');
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ items: Found[]; note: 'PARTIAL' | 'ERASED' | null }>(`${base}/members?search=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setItems(r.items);
          setNote(r.note ?? null);
        })
        .catch(() => {
          setItems([]);
          setNote(null);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, base]);
  return (
    <div className="mt-2 space-y-1">
      <input className="input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('teachingRota.find_member') ?? ''} aria-label={t('teachingRota.find_member') ?? ''} />
      {items.map((m) => (
        // A greyed member stays tappable: tapping says why she cannot be chosen (a dead button looks like "nothing happens").
        <button
          key={m.id}
          type="button"
          aria-disabled={Boolean(m.takenBy) || !m.hasAccount}
          onClick={() => (m.takenBy ? setHint(t('teachingRota.hint_taken', { member: m.name, name: m.takenBy })) : !m.hasAccount ? setHint(t('teachingRota.hint_no_account', { member: m.name })) : onPick(m.id))}
          className={`flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm ${m.takenBy || !m.hasAccount ? 'opacity-50' : ''}`}
          data-testid="member-result"
        >
          <span>{m.name}</span>
          <span className="text-xs text-slate-500">{!m.hasAccount ? t('teachingRota.no_account') : m.takenBy ? t('teachingRota.already_on', { name: m.takenBy }) : m.language === 'fr' ? '🇫🇷' : '🇬🇧'}</span>
        </button>
      ))}
      {note === 'PARTIAL' && <p className="text-xs text-amber-800" data-testid="member-partial">{t('teachingRota.partial_found')}</p>}
      {q.trim().length >= 2 && items.length === 0 && <p className="text-xs text-slate-500">{note === 'ERASED' ? t('teachingRota.erased_found') : t('teachingRota.nobody_found')}</p>}
      {hint && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="member-hint">{hint}</p>}
    </div>
  );
}

function GroupPicker({ base, onPick }: { base: string; onPick: (id: string | null) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GroupFound[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setItems([]);
    const timer = window.setTimeout(() => {
      api.get<{ items: GroupFound[] }>(`${base}/groups?search=${encodeURIComponent(q.trim())}`).then((r) => setItems(r.items)).catch(() => setItems([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, base]);
  return (
    <div className="mt-2 space-y-1">
      <input className="input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('teachingRota.find_group') ?? ''} aria-label={t('teachingRota.find_group') ?? ''} />
      {items.map((g) => (
        <button key={g.id} type="button" onClick={() => onPick(g.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm" data-testid="group-result">
          {g.name}
        </button>
      ))}
      <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={() => onPick(null)}>{t('teachingRota.no_group')}</button>
    </div>
  );
}

// The recording a teacher made ahead of time: recorded, text corrected, approved, posted.
function RecordingStatus({ row }: { row: TeacherRow }) {
  const { t } = useTranslation();
  const key = row.recording ?? 'none';
  return <p className="mt-1 text-xs text-slate-700" data-testid="recording-status">🎙 {t(`teachingRota.recording_${key}`)}</p>;
}

// Where this week's assignment went: sent as a private message, opened, answered (so the central admin is never left guessing).
function AssignmentStatus({ row, base }: { row: TeacherRow; base: string }) {
  const { t, i18n } = useTranslation();
  const a = row.assignment;
  if (!a) return <p className="mt-1 text-xs text-slate-500" data-testid="assignment-status">{t('teachingRota.assignment_not_sent')}</p>;
  const when = new Date(a.sentAt).toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
  // Only the central admin's own member profile has the private chats, so the link is there.
  const canOpen = a.conversationId && base.includes('/api/member/');
  return (
    <p className="mt-1 text-xs text-slate-700" data-testid="assignment-status">
      📨 {t('teachingRota.assignment_sent', { when })} · {a.messageSent ? (a.replied ? `💬 ${t('teachingRota.assignment_replied')}` : a.seen ? `✓✓ ${t('teachingRota.assignment_seen')}` : `✓ ${t('teachingRota.assignment_delivered')}`) : t('teachingRota.assignment_alert_only')}
      {canOpen && (
        <>
          {' · '}
          <a className="font-semibold text-brand-700 underline" href={`/member/chats/private/${a.conversationId}`}>{t('teachingRota.assignment_open_chat')}</a>
        </>
      )}
    </p>
  );
}

function TeacherCard({ row, base, onChanged, onError }: { row: TeacherRow; base: string; onChanged: (o: Overview) => void; onError: (m: string) => void }) {
  const { t, i18n } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RatingDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [localError, setLocalError] = useState('');
  const [page, setPage] = useState<TeachingView | null>(null);
  const [showPage, setShowPage] = useState(false);
  // "See their page": exactly what this leader sees when they open My teaching.
  async function togglePage() {
    setShowPage((v) => !v);
    if (!page) {
      try {
        setPage(await api.get<TeachingView>(`${base}/teachers/${row.id}/page`));
      } catch (e) {
        setLocalError(e instanceof ApiError ? e.message : t('teachingRota.load_failed'));
      }
    }
  }
  async function toggleDetail() {
    setShowDetail((v) => !v);
    if (!detail) {
      try {
        setDetail(await api.get<RatingDetail>(`${base}/ratings/${row.id}`));
      } catch {
        onError(t('teachingRota.load_failed'));
      }
    }
  }
  async function patch(body: Record<string, unknown>) {
    try {
      setLocalError('');
      onChanged(await api.patch<Overview>(`${base}/teachers/${row.id}`, body));
      setPicking(false);
    } catch (e) {
      // Shown right here, under the name (the panel's own message is at the top, out of sight on a phone).
      setLocalError(e instanceof ApiError ? e.message : t('teachingRota.save_failed'));
    }
  }
  return (
    <li className={`rounded-xl border p-3 ${row.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`} data-testid="teacher-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{row.name}</p>
          {row.personId ? (
            <p className="text-xs text-green-700">
              ✓ {row.memberName} {row.language === 'fr' ? '🇫🇷' : '🇬🇧'}
            </p>
          ) : (
            <p className="text-xs font-medium text-amber-700">{t('teachingRota.not_matched')}</p>
          )}
        </div>
        <button type="button" className="shrink-0 text-xs font-semibold text-brand-700 underline" onClick={() => setPicking((v) => !v)}>
          {row.personId ? t('teachingRota.change_member') : t('teachingRota.pick_member')}
        </button>
      </div>
      {row.active && row.personId && <AssignmentStatus row={row} base={base} />}
      {row.active && row.personId && <RecordingStatus row={row} />}
      {row.personId && (
        <>
          <button type="button" className="mt-1 text-xs font-semibold text-brand-700 underline" onClick={() => void togglePage()} data-testid="see-page">
            👁 {showPage ? t('teachingRota.hide_page') : t('teachingRota.see_page')}
          </button>
          {showPage && page && (
            <div className="mt-2 space-y-3 rounded-xl border border-dashed border-brand-300 bg-slate-50 p-3" data-testid="teacher-page-preview">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('teachingRota.page_preview', { name: row.memberName ?? row.name })}</p>
              <TeachingPageBody view={page} />
            </div>
          )}
        </>
      )}
      {picking && <MemberPicker base={base} onPick={(id) => void patch({ personId: id })} />}
      {localError && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800" data-testid="teacher-error">{localError}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select className="input" value={row.dayOfWeek} aria-label={t('teachingRota.day') ?? ''} onChange={(e) => void patch({ dayOfWeek: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {dayName(d, i18n.language)}
            </option>
          ))}
        </select>
        <input className="input" type="time" value={row.startTime} aria-label={t('teachingRota.time') ?? ''} onChange={(e) => e.target.value && void patch({ startTime: e.target.value })} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => setOpen((v) => !v)}>
          {open ? t('teachingRota.hide_weeks') : t('teachingRota.show_weeks')}
        </button>
        <button type="button" className={`text-xs font-semibold underline ${row.active ? 'text-red-700' : 'text-green-700'}`} onClick={() => void patch({ active: !row.active })}>
          {row.active ? t('teachingRota.stop_teacher') : t('teachingRota.restore_teacher')}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm" data-testid="rating-line">
        {row.ratings.total > 0 ? (
          <span className="font-semibold text-slate-800">
            ⭐ {row.ratings.average} <span className="font-normal text-slate-500">· {t('teachingRota.ratings_count', { count: row.ratings.total })}</span>
          </span>
        ) : (
          <span className="text-xs text-slate-500">{t('teachingRota.no_ratings')}</span>
        )}
        {row.ratings.total > 0 && (
          <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => void toggleDetail()}>
            {showDetail ? t('teachingRota.hide_weeks') : t('teachingRota.see_ratings')}
          </button>
        )}
      </div>
      {showDetail && detail && (
        <ul className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2" data-testid="rating-detail">
          {detail.weeks.map((w) => (
            <li key={w.weekStart} className="text-sm">
              <p className="font-medium text-slate-900">
                {new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · {w.topic}
              </p>
              <CountChips counts={w.counts} />
              <p className="mt-1 text-xs text-slate-600">{w.raters.map((r) => `${r.name}: ${t(`teachingRota.level_${r.level}`)}`).join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ol className="mt-2 space-y-0.5 text-sm text-slate-700" data-testid="upcoming">
          {row.upcoming.map((u) => (
            <li key={u.weekStart}>
              <span className="text-slate-500">{new Date(`${u.weekStart}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span> · {u.title}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function TopicReader({ base, topics, lang, setLang, onChanged }: { base: string; topics: Overview['topics']; lang: 'en' | 'fr'; setLang: (l: 'en' | 'fr') => void; onChanged: (o: Overview) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [text, setText] = useState<{ kind: 'right' | 'key'; en: TopicText; fr: TopicText | null } | null>(null);
  async function show(n: number) {
    setEditing(null);
    if (open === n) return setOpen(null);
    setOpen(n);
    setText(null);
    try {
      setText(await api.get<{ kind: 'right' | 'key'; en: TopicText; fr: TopicText | null }>(`${base}/topics/${n}`));
    } catch {
      setText(null);
    }
  }
  const saved = (overview: unknown) => {
    onChanged(overview as Overview);
    const wasOpen = open;
    setEditing(null);
    setText(null);
    if (wasOpen !== null) void api.get<{ kind: 'right' | 'key'; en: TopicText; fr: TopicText | null }>(`${base}/topics/${wasOpen}`).then(setText).catch(() => {});
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${lang === l ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
              {l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={() => { setOpen(null); setEditing('new'); }} data-testid="add-topic">＋ {t('teachingRota.add_teaching')}</button>
      </div>
      {editing === 'new' && <TeachingTopicEditor base={base} number={null} initial={null} onSaved={saved} onCancel={() => setEditing(null)} />}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {topics.map((tp) => (
          <li key={tp.number} className="p-3">
            <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => void show(tp.number)}>
              <span className="text-sm font-medium text-slate-900">
                {tp.number}. {tp.title}
              </span>
              <span className={`text-xs ${tp.hasFrench ? 'text-green-700' : 'text-amber-700'}`}>{tp.hasFrench ? '🇫🇷 ✓' : t('teachingRota.no_french')}</span>
              {tp.hasBook === false && <span className="text-xs text-amber-700">{t('teachingRota.no_book')}</span>}
            </button>
            {open === tp.number && (
              <div className="mt-3 space-y-3">
                {!text ? (
                  <p className="text-sm text-slate-500">{t('common.loading')}</p>
                ) : editing === tp.number ? (
                  <TeachingTopicEditor base={base} number={tp.number} initial={text} onSaved={saved} onCancel={() => setEditing(null)} />
                ) : (
                  <>
                    {lang === 'fr' && !text.fr ? <p className="text-sm text-amber-700">{t('teachingRota.no_french')}</p> : <TeachingTopicView text={(lang === 'fr' ? text.fr : text.en) as TopicText} />}
                    <button type="button" className="btn-secondary w-full" onClick={() => setEditing(tp.number)} data-testid={`edit-topic-${tp.number}`}>✏️ {t('teachingRota.edit_teaching')}</button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// "Weekly teaching" for the central admin: load the plan file, match the names to members, set each teacher's day and
// time, read the French, and switch the rota on. Nothing reaches a teacher until it is switched on. The same panel is
// used in the admin dashboard and in the National Coordinator's own profile (base differs).
export function TeachingRotaPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [lang, setLang] = useState<'en' | 'fr'>('fr');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pickingGroup, setPickingGroup] = useState(false);
  const [bestFirst, setBestFirst] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDay, setNewDay] = useState(1);
  const [newTime, setNewTime] = useState('07:00');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.get<Overview>(`${base}/overview`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t('teachingRota.load_failed')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  async function loadFile(file: File) {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const plan = JSON.parse(await readText(file));
      const r = await api.post<{ summary: { topicsAdded: number; topicsUpdated: number; teachersAdded: number; teachersKept: number }; overview: Overview }>(`${base}/plan`, plan);
      setData(r.overview);
      setNote(t('teachingRota.loaded', r.summary));
    } catch (e) {
      fail(e instanceof SyntaxError ? new ApiError(400, t('teachingRota.not_a_plan')) : e, t('teachingRota.load_failed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function setSettings(body: Record<string, unknown>) {
    setError(null);
    setNote(null);
    try {
      setData(await api.put<Overview>(`${base}/settings`, body));
    } catch (e) {
      fail(e, t('teachingRota.save_failed'));
    }
  }

  async function switchRota() {
    if (!data?.settings) return;
    if (!data.settings.enabled && !window.confirm(t('teachingRota.confirm_on') ?? '')) return;
    await setSettings({ enabled: !data.settings.enabled });
  }

  async function chooseGroup(id: string | null) {
    await setSettings({ ratersCommunityId: id });
    setPickingGroup(false);
  }

  async function sendNow() {
    if (!window.confirm(t('teachingRota.confirm_send') ?? '')) return;
    setError(null);
    setNote(null);
    try {
      const r = await api.post<SendResult>(`${base}/send-assignments`, {});
      setData(r.overview);
      const lines = [t('teachingRota.sent_now', { sent: r.sent, alreadySent: r.alreadySent })];
      if (r.sentTo.length) lines.push(t('teachingRota.sent_to', { names: r.sentTo.join(', ') }));
      if (r.passed.length) lines.push(t('teachingRota.sent_passed', { names: r.passed.join(', ') }));
      if (r.notMatched.length) lines.push(t('teachingRota.sent_not_matched', { names: r.notMatched.join(', ') }));
      lines.push(t('teachingRota.sent_where'));
      setNote(lines.join('\n'));
    } catch (e) {
      fail(e, t('teachingRota.save_failed'));
    }
  }

  async function sendHowTo(again = false) {
    if (!window.confirm(t(again ? 'teachingRota.confirm_howto_again' : 'teachingRota.confirm_howto') ?? '')) return;
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ sent: number; alreadySent: number; sentTo: string[]; notMatched: string[] }>(`${base}/send-howto`, again ? { again: true } : {});
      const lines = [t(again ? 'teachingRota.howto_sent_again' : 'teachingRota.howto_sent', { sent: r.sent, alreadySent: r.alreadySent })];
      if (r.sentTo.length) lines.push(t('teachingRota.sent_to', { names: r.sentTo.join(', ') }));
      if (r.notMatched.length) lines.push(t('teachingRota.sent_not_matched', { names: r.notMatched.join(', ') }));
      setNote(lines.join('\n'));
    } catch (e) {
      fail(e, t('teachingRota.save_failed'));
    }
  }

  async function runMatch() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ result: MatchResult; overview: Overview }>(`${base}/match`, {});
      setData(r.overview);
      setMatch(r.result);
    } catch (e) {
      fail(e, t('teachingRota.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function addTeacher(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      setData(await api.post<Overview>(`${base}/teachers`, { name: newName.trim(), dayOfWeek: newDay, startTime: newTime }));
      setNewName('');
      setAdding(false);
    } catch (err) {
      fail(err, t('teachingRota.save_failed'));
    }
  }

  if (!data) return <p className="text-slate-500">{error ?? t('common.loading')}</p>;
  const s = data.settings;
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const active = data.teachers.filter((r) => r.active);
  const matched = active.filter((r) => r.personId).length;

  return (
    <section className="space-y-4" data-testid="teaching-rota-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('teachingRota.admin_title')}</h2>
        <p className="text-sm text-slate-600">{t('teachingRota.admin_help')}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {note && <p className="whitespace-pre-line rounded-lg bg-green-50 p-3 text-sm text-green-800" data-testid="rota-note">{note}</p>}

      <div className="card space-y-2 !p-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('teachingRota.plan_file')}</h3>
        <p className="text-sm text-slate-600">{s ? t('teachingRota.plan_loaded', { topics: data.topics.length, teachers: data.teachers.length }) : t('teachingRota.plan_none')}</p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="plan-input" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
        <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
          {s ? t('teachingRota.load_another') : t('teachingRota.load_plan')}
        </button>
      </div>

      {s && (
        <>
          <div className="card space-y-3 !p-3" data-testid="rota-status">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{s.enabled ? t('teachingRota.is_on') : t('teachingRota.is_off')}</p>
                <p className="text-xs text-slate-500">{t('teachingRota.first_week_is', { date: fmtDay(s.startDate) })}</p>
              </div>
              <button type="button" className={s.enabled ? 'btn-secondary' : 'btn-primary'} data-testid="rota-switch" onClick={() => void switchRota()}>
                {s.enabled ? t('teachingRota.switch_off') : t('teachingRota.switch_on')}
              </button>
            </div>
            {!s.enabled && <p className="text-xs text-slate-500">{t('teachingRota.off_note')}</p>}
            {data.frenchNeeded && (
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-1" checked={s.frenchChecked} onChange={(e) => void setSettings({ frenchChecked: e.target.checked })} />
                <span>{t('teachingRota.french_checked')}</span>
              </label>
            )}
            {s.enabled && (
              <button type="button" className="btn-secondary w-full" onClick={() => void sendNow()} data-testid="send-now">
                {t('teachingRota.send_now')}
              </button>
            )}
            {s.enabled && (
              <>
                <button type="button" className="btn-secondary w-full" onClick={() => void sendHowTo()} data-testid="send-howto">
                  {t('teachingRota.send_howto')}
                </button>
                <p className="text-xs text-slate-500">{t('teachingRota.send_howto_help')}</p>
                <button type="button" className="btn-secondary w-full" onClick={() => void sendHowTo(true)} data-testid="send-howto-again">
                  {t('teachingRota.send_howto_again')}
                </button>
                <p className="text-xs text-slate-500">{t('teachingRota.send_howto_again_help')}</p>
              </>
            )}
            <div className="rounded-lg bg-slate-50 p-2 text-sm" data-testid="raters-box">
              <p className="font-medium text-slate-900">{t('teachingRota.raters_title')}</p>
              <p className="text-slate-700">{data.raters.communityName ? t('teachingRota.raters_group', { name: data.raters.communityName, count: data.raters.count }) : t('teachingRota.raters_none', { count: data.raters.count })}</p>
              <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => setPickingGroup((v) => !v)}>{t('teachingRota.raters_change')}</button>
              {pickingGroup && <GroupPicker base={base} onPick={(id) => void chooseGroup(id)} />}
            </div>
            {data.warnings.filter((w) => WARNING_KEYS[w]).map((w) => (
              <p key={w} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">⚠ {t(WARNING_KEYS[w])}</p>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('teachingRota.teachers', { count: active.length })}</h3>
              <span className="text-xs text-slate-500">{t('teachingRota.matched_count', { matched, total: active.length })}</span>
            </div>
            {matched < active.length && (
              <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void runMatch()}>
                {t('teachingRota.match_names')}
              </button>
            )}
            {match && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="match-result">
                <p>{t('teachingRota.match_done', { count: match.matched })}</p>
                {match.ambiguous.length > 0 && <p className="mt-1">{t('teachingRota.match_ambiguous')}: {match.ambiguous.join(', ')}</p>}
                {match.notFound.length > 0 && <p className="mt-1">{t('teachingRota.match_not_found')}: {match.notFound.join(', ')}</p>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={bestFirst} onChange={(e) => setBestFirst(e.target.checked)} />
              {t('teachingRota.best_first')}
            </label>
            <ul className="space-y-2">
              {(bestFirst ? [...data.teachers].sort((a, b) => (b.ratings.average ?? -1) - (a.ratings.average ?? -1)) : data.teachers).map((r) => (
                <TeacherCard key={r.id} row={r} base={base} onChanged={(o) => { setData(o); setError(null); }} onError={setError} />
              ))}
            </ul>
            {adding ? (
              <form onSubmit={addTeacher} className="card space-y-2 !p-3">
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('teachingRota.new_name') ?? ''} aria-label={t('teachingRota.new_name') ?? ''} autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" value={newDay} onChange={(e) => setNewDay(Number(e.target.value))} aria-label={t('teachingRota.day') ?? ''}>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>
                        {dayName(d, i18n.language)}
                      </option>
                    ))}
                  </select>
                  <input className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label={t('teachingRota.time') ?? ''} />
                </div>
                <p className="text-xs text-slate-500">{t('teachingRota.new_help')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="submit" className="btn-primary" disabled={!newName.trim()}>{t('teachingRota.add')}</button>
                  <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>{t('teachingRota.cancel')}</button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn-secondary w-full" onClick={() => setAdding(true)}>＋ {t('teachingRota.add_teacher')}</button>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('teachingRota.read_topics')}</h3>
            <p className="text-xs text-slate-500">{t('teachingRota.read_topics_help')}</p>
            <TopicReader base={base} topics={data.topics} lang={lang} setLang={setLang} onChanged={(o) => { setData(o); setNote(t('teachingRota.topic_saved')); }} />
          </div>
        </>
      )}
    </section>
  );
}
