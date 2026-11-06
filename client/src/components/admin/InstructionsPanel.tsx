import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { pickText } from '../../lib/instructionText';

interface Leader {
  personId: string;
  name: string;
  generations: number[];
  assemblies: string[];
}
type Status = 'DONE' | 'LATE' | 'SEEN' | 'WAITING';
interface Row {
  id: string;
  title: string;
  titleTr: string | null;
  language: 'en' | 'fr' | null;
  audience: 'ALL_LEADERS' | 'GENERATIONS' | 'PICKED';
  generations: number[];
  dueAt: string | null;
  createdAt: string;
  total: number;
  seen: number;
  done: number;
  late: number;
}
interface Tracker {
  id: string;
  title: string;
  body: string;
  language: 'en' | 'fr' | null;
  titleTr: string | null;
  bodyTr: string | null;
  dueAt: string | null;
  repliesVisible: boolean;
  recipients: { personId: string; name: string; status: Status; seenAt: string | null; doneAt: string | null; note: string | null }[];
}

const STATUS_STYLE: Record<Status, string> = {
  DONE: 'bg-green-100 text-green-800',
  SEEN: 'bg-sky-100 text-sky-800',
  WAITING: 'bg-slate-100 text-slate-700',
  LATE: 'bg-red-100 text-red-800',
};

// The National Coordinator's desk for instructions to leaders: write one (to every leader, to chosen generations,
// or to hand-picked leaders), then follow it up — who has seen it, who is done, who is late — and remind. Offered in
// the admin dashboard and in the central admin's member profile (base says which set of routes to use).
export function InstructionsPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [generations, setGenerations] = useState<number[]>([]);
  const [items, setItems] = useState<Row[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    api.get<{ items: Row[] }>(`${base}/`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }
  useEffect(() => {
    load();
    api.get<{ leaders: Leader[]; generations: number[] }>(`${base}/leaders`).then((r) => { setLeaders(r.leaders); setGenerations(r.generations); }).catch(() => {});
  }, [base]);

  const audienceLabel = (r: Row) =>
    r.audience === 'ALL_LEADERS' ? t('instructions.aud_all') : r.audience === 'GENERATIONS' ? t('instructions.aud_gen', { list: r.generations.map((g) => (g === 0 ? t('instructions.hq') : g)).join(', ') }) : t('instructions.aud_picked');

  return (
    <div className="space-y-4" data-testid="instructions-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('instructions.title')}</h2>
        <p className="text-sm text-slate-600">{t('instructions.help')}</p>
      </div>

      {!composing && (
        <button type="button" className="btn-primary" onClick={() => setComposing(true)} data-testid="instruction-new">
          + {t('instructions.new')}
        </button>
      )}
      {composing && (
        <Compose
          base={base}
          leaders={leaders}
          generations={generations}
          onCancel={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            load();
          }}
        />
      )}

      {items === null && <p className="text-sm text-slate-500">{t('instructions.loading')}</p>}
      {items && items.length === 0 && !composing && <p className="card text-sm text-slate-600">{t('instructions.none')}</p>}
      <ul className="space-y-2">
        {(items ?? []).map((r) => (
          <li key={r.id} className="card space-y-2">
            <button type="button" className="block w-full text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)} data-testid={`instruction-row-${r.id}`}>
              <span className="block font-semibold text-brand-900">{pickText(i18n.language, r.language, r.title, r.titleTr)}</span>
              <span className="block text-xs text-slate-500">
                {audienceLabel(r)} · {new Date(r.createdAt).toLocaleDateString(i18n.language)}
                {r.dueAt ? ` · ${t('instructions.due')} ${new Date(r.dueAt).toLocaleDateString(i18n.language)}` : ''}
              </span>
              <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">{t('instructions.count_done', { done: r.done, total: r.total })}</span>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{t('instructions.count_seen', { count: r.seen })}</span>
                {r.late > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{t('instructions.count_late', { count: r.late })}</span>}
              </span>
            </button>
            {openId === r.id && <TrackerView base={base} id={r.id} onChanged={load} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Compose({ base, leaders, generations, onCancel, onSent }: { base: string; leaders: Leader[]; generations: number[]; onCancel: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'ALL_LEADERS' | 'GENERATIONS' | 'PICKED'>('ALL_LEADERS');
  const [gens, setGens] = useState<number[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [due, setDue] = useState('');
  const [replies, setReplies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = useMemo(() => {
    if (audience === 'ALL_LEADERS') return leaders.length;
    if (audience === 'GENERATIONS') return leaders.filter((l) => l.generations.some((g) => gens.includes(g))).length;
    return leaders.filter((l) => picked.includes(l.personId)).length;
  }, [audience, gens, picked, leaders]);

  const shown = leaders.filter((l) => !filter.trim() || `${l.name} ${l.assemblies.join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/`, {
        title,
        body,
        audience,
        generations: audience === 'GENERATIONS' ? gens : [],
        personIds: audience === 'PICKED' ? picked : [],
        dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
        repliesVisible: replies,
      });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('instructions.send_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3" data-testid="instruction-compose">
      <label className="block text-sm font-semibold text-slate-700">
        {t('instructions.f_title')}
        <input className="input mt-1" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        {t('instructions.f_body')}
        <textarea className="input mt-1 min-h-[8rem]" value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="text-xs text-slate-500">{t('instructions.translated_note')}</p>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold text-slate-700">{t('instructions.f_to')}</legend>
        {(['ALL_LEADERS', 'GENERATIONS', 'PICKED'] as const).map((a) => (
          <label key={a} className="flex items-center gap-2 text-sm">
            <input type="radio" name="aud" checked={audience === a} onChange={() => setAudience(a)} />
            {t(`instructions.to_${a}`)}
          </label>
        ))}
      </fieldset>
      {audience === 'GENERATIONS' && (
        <div className="flex flex-wrap gap-2">
          {generations.map((g) => (
            <button key={g} type="button" onClick={() => setGens(toggle(gens, g))} aria-pressed={gens.includes(g)}
              className={`rounded-full border px-3 py-1 text-sm ${gens.includes(g) ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
              {g === 0 ? t('instructions.hq') : t('instructions.generation', { n: g })}
            </button>
          ))}
        </div>
      )}
      {audience === 'PICKED' && (
        <div className="space-y-2">
          <input className="input" placeholder={t('instructions.find_leader') ?? ''} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {shown.map((l) => (
              <li key={l.personId}>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={picked.includes(l.personId)} onChange={() => setPicked(toggle(picked, l.personId))} />
                  <span>
                    <span className="font-medium">{l.name}</span>
                    <span className="block text-xs text-slate-500">{l.assemblies.join(', ')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="block text-sm font-semibold text-slate-700">
        {t('instructions.f_due')}
        <input type="date" className="input mt-1" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={replies} onChange={(e) => setReplies(e.target.checked)} />
        {t('instructions.f_replies')}
      </label>

      <p className="text-sm font-semibold text-brand-900" data-testid="instruction-count">{t('instructions.will_go', { count })}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={busy || !title.trim() || !body.trim() || count === 0} onClick={() => void send()} data-testid="instruction-send">
          {busy ? t('instructions.sending') : t('instructions.send')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('instructions.cancel')}</button>
      </div>
    </div>
  );
}

function TrackerView({ base, id, onChanged }: { base: string; id: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Tracker | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<Tracker>(`${base}/${id}`).then(setData).catch(() => setNote(t('instructions.load_failed')));
  useEffect(() => { void load(); }, [id]);

  async function remind() {
    setBusy(true);
    try {
      const r = await api.post<{ reminded: number }>(`${base}/${id}/remind`, {});
      setNote(r.reminded > 0 ? t('instructions.reminded', { count: r.reminded }) : t('instructions.reminded_none'));
      onChanged();
      await load();
    } catch {
      setNote(t('instructions.remind_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-500">{note ?? t('instructions.loading')}</p>;
  const unfinished = data.recipients.filter((r) => r.status !== 'DONE').length;
  return (
    <div className="space-y-3 border-t border-slate-200 pt-3" data-testid="instruction-tracker">
      <p className="whitespace-pre-wrap text-sm text-slate-800">{pickText(i18n.language, data.language, data.body, data.bodyTr)}</p>
      {unfinished > 0 && (
        <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => void remind()} data-testid="instruction-remind">
          ⏰ {t('instructions.remind', { count: unfinished })}
        </button>
      )}
      {note && <p className="text-sm text-slate-600">{note}</p>}
      <ul className="divide-y divide-slate-100">
        {data.recipients.map((r) => (
          <li key={r.personId} className="flex items-start justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{r.name}</span>
              {r.note && <span className="block text-xs text-slate-600">“{r.note}”</span>}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{t(`instructions.status_${r.status}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
