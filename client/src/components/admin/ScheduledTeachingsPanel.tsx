import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { cameroonLabel, fromLocalInput, toLocalInput } from '../../lib/scheduleTime';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { ScheduledQuizEditor, type QuizSummary } from './ScheduledQuizEditor';

type Lang = 'en' | 'fr';
type Status = 'RECORDED' | 'WRITING' | 'TEXT_READY' | 'FAILED' | 'APPROVED' | 'POSTED';
interface Item {
  id: string;
  communityId: string;
  communityName: string;
  postAt: string;
  liveTeaching: boolean;
  status: Status;
  mode: 'single' | 'pair';
  spoken: Lang;
  clips: { language: Lang; audioUrl: string | null; textState: 'WAITING' | 'DONE' | 'FAILED' }[];
  textEn: string;
  textFr: string;
  autoTranslated: Lang | null;
  missed: boolean;
  canChange: boolean;
  postedAt: string | null;
  quiz: QuizSummary | null;
}

const BASE = '/api/member/scheduled-teachings';
const NAME: Record<Lang, string> = { en: 'English', fr: 'Français' };

// One teaching kept for later: listen, check the written text in your own language, approve, change the time, post now or delete.
function ScheduledCard({ item, onChanged, onRemoved }: { item: Item; onChanged: (i: Item) => void; onRemoved: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const { member } = useMemberAuth();
  const [texts, setTexts] = useState<{ textEn: string; textFr: string }>({ textEn: item.textEn, textFr: item.textFr });
  const [dirty, setDirty] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(item.postAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Words that arrive later fill the boxes, unless the author is already editing.
  useEffect(() => {
    if (!dirty) setTexts({ textEn: item.textEn, textFr: item.textFr });
  }, [item.textEn, item.textFr, dirty]);
  useEffect(() => setWhen(toLocalInput(item.postAt)), [item.postAt]);

  async function run<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      after?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('scheduledTeachings.failed'));
    } finally {
      setBusy(false);
    }
  }
  const url = `${BASE}/${item.id}`;
  const changed = (i: Item) => {
    setDirty(false);
    onChanged(i);
  };
  const saveText = () => run(() => api.put<Item>(`${url}/text`, item.mode === 'pair' ? texts : item.spoken === 'fr' ? { textFr: texts.textFr } : { textEn: texts.textEn }), changed);
  const approve = () =>
    run(async () => {
      if (dirty) await api.put<Item>(`${url}/text`, item.mode === 'pair' ? texts : item.spoken === 'fr' ? { textFr: texts.textFr } : { textEn: texts.textEn });
      return api.post<Item>(`${url}/approve`, {});
    }, changed);
  const retry = () => run(() => api.post<Item>(`${url}/retry`, {}), changed);
  const saveTime = () => {
    const iso = fromLocalInput(when);
    if (!iso) return setError(t('bilingual.need_time'));
    return run(() => api.patch<Item>(url, { postAt: iso }), onChanged);
  };
  const toggleLive = (live: boolean) => run(() => api.patch<Item>(url, { liveTeaching: live }), onChanged);
  const postNow = () => {
    if (!window.confirm(t('scheduledTeachings.confirm_post_now') ?? '')) return;
    void run(() => api.post<Item>(`${url}/post-now`, {}), onChanged);
  };
  const remove = () => {
    if (!window.confirm(t('scheduledTeachings.confirm_delete') ?? '')) return;
    void run(() => api.delete(url), () => onRemoved(item.id));
  };

  const writing = item.status === 'RECORDED' || item.status === 'WRITING';
  const failedClips = item.clips.filter((c) => c.textState === 'FAILED').length;
  const posted = item.status === 'POSTED';
  const editable = (lang: Lang) => item.mode === 'pair' || item.spoken === lang;
  const label = (lang: Lang) => (item.mode === 'pair' ? t('scheduledTeachings.words_in', { language: NAME[lang] }) : t('scheduledTeachings.your_words', { language: NAME[lang] }));
  const auto = item.mode === 'single' && item.autoTranslated;

  return (
    <section className="card space-y-3" data-testid={`scheduled-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-900">{item.communityName}</p>
          <p className="text-sm text-slate-700" data-testid="scheduled-when">
            {posted ? t('scheduledTeachings.posted_at', { when: cameroonLabel(item.postedAt ?? item.postAt, i18n.language) }) : t('scheduledTeachings.posts_at', { when: cameroonLabel(item.postAt, i18n.language) })}{' '}
            <span className="text-slate-500">({t('teachingRota.cameroon_time')})</span>
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${posted ? 'bg-green-50 text-green-800' : item.missed ? 'bg-red-50 text-red-700' : item.status === 'APPROVED' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`} data-testid="scheduled-status">
          {posted ? t('scheduledTeachings.s_posted') : item.missed ? t('scheduledTeachings.s_missed') : t(`scheduledTeachings.s_${item.status}`)}
        </span>
      </div>

      {!posted && (
        <div className="space-y-2">
          {item.clips.map((c) =>
            c.audioUrl ? (
              <div key={c.language}>
                {item.clips.length > 1 && <p className="text-xs font-semibold text-slate-600">{c.language === 'en' ? '🇬🇧' : '🇫🇷'} {NAME[c.language]}</p>}
                <audio controls preload="metadata" src={c.audioUrl} className="w-full" aria-label={NAME[c.language]} />
              </div>
            ) : null,
          )}
        </div>
      )}

      {item.missed && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" data-testid="scheduled-missed">{t('scheduledTeachings.missed_note')}</p>}
      {writing && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="scheduled-writing">⏳ {t('scheduledTeachings.writing')}</p>}

      {!posted && !writing && (
        <div className="space-y-2">
          {failedClips > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="scheduled-failed">{t('scheduledTeachings.failed_words', { count: failedClips })}</p>}
          <p className="text-xs text-slate-600">{t('scheduledTeachings.check_help')}</p>
          {(['en', 'fr'] as const).map((lang) => {
            if (!editable(lang)) return null;
            const key = lang === 'en' ? 'textEn' : 'textFr';
            return (
              <div key={lang}>
                <label className="block text-sm font-semibold text-slate-800" htmlFor={`sch-${item.id}-${lang}`}>{label(lang)}</label>
                <textarea id={`sch-${item.id}-${lang}`} className="input min-h-[10rem] w-full" value={texts[key]} onChange={(e) => { setTexts({ ...texts, [key]: e.target.value }); setDirty(true); }} data-testid={`scheduled-text-${lang}`} />
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => void saveText()} data-testid="scheduled-save">{t('teachingRecording.save_text')}</button>
            <button type="button" className="btn-primary" disabled={busy || (!texts.textEn.trim() && !texts.textFr.trim()) || (item.status === 'APPROVED' && !dirty)} onClick={() => void approve()} data-testid="scheduled-approve">✓ {t('teachingRecording.approve')}</button>
          </div>
          {(item.status === 'FAILED' || failedClips > 0) && (
            <button type="button" className="text-sm font-semibold text-brand-700 underline" disabled={busy} onClick={() => void retry()} data-testid="scheduled-retry">{t('teachingRecording.try_again')}</button>
          )}
          {item.status === 'APPROVED' && !dirty && (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" data-testid="scheduled-approved">
              ✓ {t('scheduledTeachings.approved')} {item.mode === 'single' ? (auto ? t('scheduledTeachings.other_ready') : t('scheduledTeachings.other_making')) : ''}
            </p>
          )}
        </div>
      )}

      {!posted && !writing && member?.isCentralAdmin && (
        <ScheduledQuizEditor itemId={item.id} communityId={item.communityId} spokenText={item.spoken === 'fr' ? item.textFr : item.textEn} quiz={item.quiz} singleRecording={item.mode === 'single'} onChanged={onChanged} />
      )}

      {!posted && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-2">
          <label className="block text-xs font-semibold text-slate-700" htmlFor={`sch-when-${item.id}`}>{t('scheduledTeachings.change_time')}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input id={`sch-when-${item.id}`} type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="scheduled-when-input" />
            <button type="button" className="btn-secondary" disabled={busy || fromLocalInput(when) === item.postAt || !when} onClick={() => void saveTime()} data-testid="scheduled-save-time">{t('scheduledTeachings.save_time')}</button>
          </div>
          {fromLocalInput(when) && <p className="text-xs text-slate-600">{t('bilingual.cameroon_time', { when: cameroonLabel(fromLocalInput(when)!, i18n.language) })}</p>}
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={item.liveTeaching} disabled={busy} onChange={(e) => void toggleLive(e.target.checked)} className="h-5 w-5 rounded border-slate-300 accent-red-600" data-testid="scheduled-live" />
            🔴 {t('bilingual.live')}
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="font-semibold text-brand-700 underline" disabled={busy} onClick={postNow} data-testid="scheduled-post-now">{t('scheduledTeachings.post_now')}</button>
            <button type="button" className="ml-auto font-semibold text-red-700 underline" disabled={busy} onClick={remove} data-testid="scheduled-delete">{t('scheduledTeachings.delete')}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700" data-testid="scheduled-error">{error}</p>}
    </section>
  );
}

export function ScheduledTeachingsPanel() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => api.get<{ items: Item[] }>(BASE).then((r) => { setItems(Array.isArray(r?.items) ? r.items : []); setError(false); }).catch(() => setError(true)), []);
  useEffect(() => {
    void load();
  }, [load]);
  // While words are being written, or the other language is being made, look again every few seconds.
  const waiting = items?.some((i) => i.status === 'RECORDED' || i.status === 'WRITING' || (i.status === 'APPROVED' && i.mode === 'single' && !i.autoTranslated));
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  const upcoming = (items ?? []).filter((i) => i.status !== 'POSTED');
  const posted = (items ?? []).filter((i) => i.status === 'POSTED');
  const replace = (next: Item) => setItems((cur) => (cur ?? []).map((i) => (i.id === next.id ? next : i)));
  return (
    <div className="space-y-3" data-testid="scheduled-panel">
      <h2 className="text-lg font-bold text-brand-900">{t('scheduledTeachings.title')}</h2>
      <p className="text-sm text-slate-600">{t('scheduledTeachings.intro')}</p>
      {error && <p className="text-sm text-red-700">{t('scheduledTeachings.load_failed')}</p>}
      {items && upcoming.length === 0 && <p className="card text-sm text-slate-600" data-testid="scheduled-empty">{t('scheduledTeachings.none')}</p>}
      {upcoming.map((i) => <ScheduledCard key={i.id} item={i} onChanged={replace} onRemoved={(id) => setItems((cur) => (cur ?? []).filter((x) => x.id !== id))} />)}
      {posted.length > 0 && <h3 className="pt-2 text-sm font-semibold text-slate-600">{t('scheduledTeachings.recent_posted')}</h3>}
      {posted.map((i) => <ScheduledCard key={i.id} item={i} onChanged={replace} onRemoved={() => undefined} />)}
    </div>
  );
}
