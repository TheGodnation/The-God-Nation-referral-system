import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

type Flag = 'EMERGENCY' | 'NEEDS_ATTENTION' | 'UNABLE_TO_REACH' | 'OVERDUE' | 'NOT_YET_CONTACTED' | 'CONTACT_TWICE_WEEK' | 'NO_REPLY' | 'SCHOOL_SLOW' | 'PAYMENT_OWED';

interface Card {
  followUpAssignmentId: string;
  personId: string;
  name: string;
  lastContactAt: string | null;
  contactDaysThisWeek: number;
  contactTarget: number;
  replied: boolean | null;
  wellbeing: 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH' | null;
  note: string | null;
  nextAction: { date: string; overdue: boolean } | null;
  prayerRequests: number;
  attendance: { attended: number; events: number };
  teachingsFinished: number;
  school: { passed: number; required: number };
  payment: { owedBooks: number; waitingConfirmation: number };
  flags: Flag[];
}

interface Colleague {
  personId: string;
  name: string;
  away: boolean;
  headcount: number;
}
interface Response {
  away: { until: string } | null;
  contactTarget: number;
  total: number;
  needingAttention: number;
  items: Card[];
}

const URGENT: Flag[] = ['EMERGENCY', 'NEEDS_ATTENTION', 'UNABLE_TO_REACH', 'OVERDUE', 'NO_REPLY'];

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// "Today" for a leader: the people they follow, as follow-up cards, the ones
// who need them most first — with a one-tap way to write to them in the
// normal private chat (voice notes, photos and files included). Members never
// see their own card.
export function MyPeople() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<Response | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[] | null>(null);
  const [pick, setPick] = useState('');
  const [awayDate, setAwayDate] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askTo, setAskTo] = useState<'PARENT' | 'CENTRAL'>('PARENT');
  const [question, setQuestion] = useState('');
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    api
      .get<Response>('/api/leader/my-people')
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  function reload() {
    api.get<Response>('/api/leader/my-people').then(setData).catch(() => {});
  }

  async function setAway(until: string | null) {
    setError(null);
    setNote(null);
    try {
      await api.put('/api/leader/my-people/away', { until });
      setNote(until ? t('myPeople.away_set') : t('myPeople.away_cleared'));
      setAwayDate('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('myPeople.away_failed'));
    }
  }

  async function ask(personId: string) {
    const text = question.trim();
    if (!text) return;
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ bypassed: boolean }>('/api/leader/escalations', { aboutPersonId: personId, question: text, urgent, to: askTo });
      setNote(r.bypassed ? t('escalations.ask_sent_passed') : t('escalations.ask_sent'));
      setAsking(false);
      setQuestion('');
      setUrgent(false);
      setOpenId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('escalations.ask_failed'));
    }
  }

  function openCard(id: string | null) {
    setAsking(false);
    setOpenId(id);
    setPick('');
    setNote(null);
    if (id && colleagues === null) {
      api
        .get<{ items: { leaders: Colleague[] }[] }>('/api/leader/my-people/colleagues')
        .then((r) => {
          const seen = new Map<string, Colleague>();
          for (const c of r.items) for (const l of c.leaders) seen.set(l.personId, l);
          setColleagues([...seen.values()]);
        })
        .catch(() => setColleagues([]));
    }
  }

  async function shareCard(personId: string, mode: 'share' | 'handover') {
    if (!pick) return;
    setError(null);
    setNote(null);
    try {
      await api.post(`/api/leader/my-people/${personId}/share`, { toLeaderPersonId: pick, mode });
      setNote(mode === 'share' ? t('myPeople.shared_done') : t('myPeople.handed_done'));
      setOpenId(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('myPeople.share_failed'));
    }
  }

  async function message(personId: string) {
    setBusy(personId);
    setError(null);
    try {
      const r = await api.post<{ conversationId: string }>(`/api/leader/my-people/${personId}/chat`, {});
      navigate(`/member/chats/private/${r.conversationId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('myPeople.chat_failed'));
    } finally {
      setBusy(null);
    }
  }

  if (failed) return null;
  if (!data || data.total === 0) return null;

  const items = data.items.filter((c) => !onlyAttention || c.flags.length > 0);

  return (
    <section className="card space-y-3" data-testid="my-people">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-brand-900">{t('myPeople.title')}</h2>
          <p className="text-sm text-slate-600">{t('myPeople.summary', { total: data.total, count: data.needingAttention })}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
          {t('myPeople.only_attention')}
        </label>
      </div>
      <p className="text-xs text-slate-500">{t('myPeople.rule', { count: data.contactTarget })}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {data.away ? (
          <>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{t('myPeople.away_until', { date: new Date(data.away.until).toLocaleDateString() })}</span>
            <button type="button" className="btn-secondary px-3 py-1" onClick={() => setAway(null)}>{t('myPeople.im_back')}</button>
          </>
        ) : (
          <>
            <label htmlFor="away-date" className="text-slate-600">{t('myPeople.im_away')}</label>
            <input id="away-date" type="date" className="input w-auto py-1" value={awayDate} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={(e) => setAwayDate(e.target.value)} />
            <button type="button" className="btn-secondary px-3 py-1" disabled={!awayDate} onClick={() => setAway(new Date(`${awayDate}T23:59:00`).toISOString())}>{t('myPeople.away_save')}</button>
          </>
        )}
      </div>
      {note && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{note}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="space-y-2">
        {items.map((c) => {
          const since = daysAgo(c.lastContactAt);
          const open = openId === c.followUpAssignmentId;
          const urgent = c.flags.some((f) => URGENT.includes(f));
          return (
            <li key={c.followUpAssignmentId} className={`rounded-xl border p-3 ${urgent ? 'border-red-200 bg-red-50/40' : c.flags.length ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" className="text-left" onClick={() => openCard(open ? null : c.followUpAssignmentId)} aria-expanded={open}>
                  <span className="font-medium text-slate-900">{c.name}</span>
                  <span className="block text-xs text-slate-500">
                    {since === null ? t('myPeople.never_contacted') : since === 0 ? t('myPeople.contact_today') : t('myPeople.contact_days_ago', { count: since })}
                    {' · '}
                    {t('myPeople.this_week', { done: Math.min(c.contactDaysThisWeek, c.contactTarget), target: c.contactTarget })}
                  </span>
                </button>
                <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy === c.personId} onClick={() => message(c.personId)}>
                  {t('myPeople.message')}
                </button>
              </div>

              {c.flags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.flags.map((f) => (
                    <span key={f} className={`rounded-full px-2 py-0.5 text-xs font-medium ${URGENT.includes(f) ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
                      {t(`myPeople.flag_${f.toLowerCase()}`)}
                    </span>
                  ))}
                </div>
              )}

              {open && (
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  <Row label={t('myPeople.replied')} value={c.replied === null ? t('myPeople.not_written_yet') : c.replied ? t('myPeople.yes') : t('myPeople.waiting_reply')} />
                  <Row label={t('myPeople.how_doing')} value={c.wellbeing ? t(`leader.followUp.wellbeing_${c.wellbeing.toLowerCase()}`) : '—'} />
                  <Row label={t('myPeople.prayer')} value={String(c.prayerRequests)} />
                  <Row label={t('myPeople.attendance')} value={`${c.attendance.attended} / ${c.attendance.events}`} />
                  <Row label={t('myPeople.teachings')} value={String(c.teachingsFinished)} />
                  <Row label={t('myPeople.school')} value={c.school.required ? `${c.school.passed} / ${c.school.required}` : '—'} />
                  <Row
                    label={t('myPeople.books')}
                    value={
                      c.payment.owedBooks === 0 && c.payment.waitingConfirmation === 0
                        ? t('myPeople.books_ok')
                        : [c.payment.owedBooks ? t('myPeople.books_owed', { count: c.payment.owedBooks }) : null, c.payment.waitingConfirmation ? t('myPeople.books_waiting', { count: c.payment.waitingConfirmation }) : null]
                            .filter(Boolean)
                            .join(' · ')
                    }
                  />
                  <Row
                    label={t('myPeople.next_action')}
                    value={c.nextAction ? `${new Date(c.nextAction.date).toLocaleDateString()}${c.nextAction.overdue ? ` (${t('myPeople.overdue')})` : ''}` : '—'}
                  />
                  {c.note && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-slate-500">{t('myPeople.last_note')}</dt>
                      <dd className="text-slate-800">{c.note}</dd>
                    </div>
                  )}
                </dl>
              )}
              {open && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  <div className="space-y-2">
                    <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setAsking((a) => !a)} aria-expanded={asking}>
                      {t('escalations.open_button')}
                    </button>
                    {asking && (
                      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">{t('escalations.ask_help')}</p>
                        <label className="label" htmlFor={`ask-to-${c.personId}`}>{t('escalations.ask_to')}</label>
                        <select id={`ask-to-${c.personId}`} className="input w-auto" value={askTo} onChange={(e) => setAskTo(e.target.value as 'PARENT' | 'CENTRAL')}>
                          <option value="PARENT">{t('escalations.to_parent')}</option>
                          <option value="CENTRAL">{t('escalations.to_central')}</option>
                        </select>
                        <label className="label" htmlFor={`ask-q-${c.personId}`}>{t('escalations.ask_question')}</label>
                        <textarea id={`ask-q-${c.personId}`} className="input" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
                          {t('escalations.ask_urgent')}
                        </label>
                        <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={!question.trim()} onClick={() => ask(c.personId)}>
                          {t('escalations.ask_send')}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{t('myPeople.share_help')}</p>
                  {colleagues && colleagues.length === 0 && <p className="text-sm text-slate-500">{t('myPeople.no_colleagues')}</p>}
                  {colleagues && colleagues.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select className="input w-auto" aria-label={t('myPeople.choose_leader')} value={pick} onChange={(e) => setPick(e.target.value)}>
                        <option value="">{t('myPeople.choose_leader')}</option>
                        {colleagues.map((l) => (
                          <option key={l.personId} value={l.personId}>
                            {l.name} ({t('myPeople.their_people', { count: l.headcount })}{l.away ? `, ${t('myPeople.is_away')}` : ''})
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={!pick} onClick={() => shareCard(c.personId, 'share')}>{t('myPeople.share_with')}</button>
                      <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={!pick} onClick={() => shareCard(c.personId, 'handover')}>{t('myPeople.hand_over')}</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="text-sm text-slate-500">{t('myPeople.nobody_needs')}</li>}
      </ul>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
