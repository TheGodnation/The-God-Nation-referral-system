import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { baseMime, pickRecorderMime } from '../../lib/chatMedia';
import { enhanceMic, openMic, teachingBitrate } from '../../lib/voiceCapture';
import { slotLabel } from './teachingTypes';

type Status = 'RECORDED' | 'WRITING' | 'TEXT_READY' | 'FAILED' | 'APPROVED' | 'POSTED';
type PartState = 'writing' | 'ready' | 'failed' | 'approved';
interface Part {
  /** null for part 1 (the recording itself). */
  id: string | null;
  n: number;
  audioUrl: string | null;
  state: PartState;
  transcript: string;
  translated: string;
  /** An older part whose words are already in part 1's text: nothing to do for it. */
  inFirstPart?: boolean;
}
interface RecordingWeek {
  weekStart: string;
  postsAt: string;
  canChange: boolean;
  recording: null | { status: Status; spokenLanguage: 'en' | 'fr' | null; transcript: string; translated: string; audioUrl: string | null; parts?: Part[]; partsWithoutText?: number };
}
interface RecordingsResponse {
  enabled: boolean;
  isTeacher: boolean;
  groupChosen: boolean;
  weeks: RecordingWeek[];
}

const ALLOWED = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'];

/** The parts as the server gives them; an older answer without them is read as one part. */
function partsOf(rec: NonNullable<RecordingWeek['recording']>): Part[] {
  if (Array.isArray(rec.parts) && rec.parts.length > 0 && rec.parts.every((p) => typeof p.n === 'number')) return rec.parts;
  const state: PartState = rec.status === 'RECORDED' || rec.status === 'WRITING' ? 'writing' : rec.status === 'FAILED' ? 'failed' : rec.status === 'TEXT_READY' ? 'ready' : 'approved';
  return [{ id: null, n: 1, audioUrl: rec.audioUrl, state, transcript: rec.transcript, translated: rec.translated }];
}

const STATE_TONE: Record<PartState, string> = {
  writing: 'bg-slate-100 text-slate-700',
  ready: 'bg-amber-100 text-amber-900',
  failed: 'bg-amber-100 text-amber-900',
  approved: 'bg-green-100 text-green-800',
};

// One part of the teaching: listen to it, read its text in the language spoken, correct it, approve it. Each part is checked on its own.
function PartCard({ part, week, language, onChanged }: { part: Part; week: RecordingWeek; language: string; onChanged: (w: RecordingWeek) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(part.transcript);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!dirty) setText(part.transcript);
  }, [part.transcript, dirty]);

  const base = `/api/member/teaching-rota/recordings/${week.weekStart}${part.id ? `/parts/${part.id}` : ''}`;
  async function call(fn: () => Promise<RecordingWeek>, after?: () => void) {
    setBusy(true);
    setError('');
    try {
      const w = await fn();
      after?.();
      onChanged(w);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('teachingRecording.failed'));
    } finally {
      setBusy(false);
    }
  }
  const save = () => call(() => api.put<RecordingWeek>(`${base}/transcript`, { text }), () => setDirty(false));
  const approve = () =>
    call(async () => {
      if (dirty || text !== part.transcript) await api.put<RecordingWeek>(`${base}/transcript`, { text });
      return api.post<RecordingWeek>(`${base}/approve`, {});
    }, () => setDirty(false));
  const retry = () => call(() => api.post<RecordingWeek>(`${base}/retry`, {}));
  const remove = () => {
    if (!part.id || !window.confirm(t('teachingRecording.confirm_remove_part', { n: part.n }) ?? '')) return;
    void call(() => api.delete<RecordingWeek>(base));
  };
  const editable = week.canChange && part.state !== 'writing' && !part.inFirstPart;

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid={`recording-part-${part.n}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">{t('teachingRecording.part_n', { n: part.n })}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_TONE[part.state]}`}>{t(`teachingRecording.state_${part.state}`)}</span>
      </div>
      {part.audioUrl && <audio controls src={part.audioUrl} className="w-full" aria-label={t('teachingRecording.part_n', { n: part.n }) ?? ''} />}
      {part.inFirstPart ? (
        <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700" data-testid="recording-in-first-part">{t('teachingRecording.in_first_part')}</p>
      ) : (
        part.state === 'writing' && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700" data-testid="recording-writing">⏳ {t('teachingRecording.writing')}</p>
      )}
      {editable && (
        <>
          {part.state === 'failed' && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="recording-failed">{t('teachingRecording.part_text_failed')}</p>}
          <label className="block text-sm font-semibold text-slate-800" htmlFor={`rec-text-${week.weekStart}-${part.n}`}>
            {language ? t('teachingRecording.text_in', { language }) : t('teachingRecording.text_label')}
          </label>
          {part.state !== 'approved' && <p className="text-xs text-slate-600">{t('teachingRecording.correct_help')}</p>}
          <textarea
            id={`rec-text-${week.weekStart}-${part.n}`}
            className="input min-h-[9rem] w-full"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            data-testid="recording-text"
          />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => void save()} data-testid="recording-save">
              {t('teachingRecording.save_text')}
            </button>
            <button type="button" className="btn-primary" disabled={busy || !text.trim() || (part.state === 'approved' && !dirty)} onClick={() => void approve()} data-testid="recording-approve">
              ✓ {t('teachingRecording.approve')}
            </button>
          </div>
          {part.state === 'failed' && (
            <button type="button" className="text-sm font-semibold text-brand-700 underline" disabled={busy} onClick={() => void retry()} data-testid="recording-retry">
              {t('teachingRecording.try_again')}
            </button>
          )}
        </>
      )}
      {part.state === 'approved' && !dirty && !part.inFirstPart && (
        <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800" data-testid="recording-approved">
          ✓ {t('teachingRecording.approved')} {part.translated ? t('teachingRecording.translated_ready') : t('teachingRecording.translating')}
        </p>
      )}
      {part.id && week.canChange && (
        <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={busy} onClick={remove} data-testid="recording-remove-part">
          {t('teachingRecording.remove_part')}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

// The teacher's own teaching recorded ahead of time, in as many parts as they like (about 5 minutes each). For each part, in order:
// record it, read the written text in the language spoken, correct it and approve it (the other language is made automatically,
// they are never asked to read it); then record the next part. At their teaching time every part is posted in the group by itself.
function WeekRecording({ week, groupChosen, onChanged }: { week: RecordingWeek; groupChosen: boolean; onChanged: (w: RecordingWeek) => void }) {
  const { t, i18n } = useTranslation();
  const rec = week.recording;
  const parts = rec ? partsOf(rec) : [];
  const last = parts[parts.length - 1];
  const next = parts.length + 1;
  const [clip, setClip] = useState<{ blob: Blob; url: string; mime: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const when = slotLabel(week.postsAt, i18n.language);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    if (clip) URL.revokeObjectURL(clip.url);
  }, [clip]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('teachingRecording.failed'));

  async function start() {
    setError('');
    try {
      const stream = await openMic();
      const mime = pickRecorderMime('audio');
      const enhanced = enhanceMic(stream);
      const bitrate = teachingBitrate();
      const options: MediaRecorderOptions = { ...(mime ? { mimeType: mime } : {}), ...(bitrate ? { audioBitsPerSecond: bitrate } : {}) };
      const r = new MediaRecorder(enhanced.stream, Object.keys(options).length > 0 ? options : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        enhanced.close();
        const type = baseMime(r.mimeType || mime || 'audio/webm');
        const blob = new Blob(chunks, { type });
        setClip({ blob, url: URL.createObjectURL(blob), mime: type });
      };
      recorder.current = r;
      r.start(1000);
      setSeconds(0);
      setPaused(false);
      setRecording(true);
      // The time shown leaves out the paused stretches.
      timer.current = window.setInterval(() => setSeconds((sec) => (recorder.current?.state === 'paused' ? sec : sec + 1)), 1000);
    } catch {
      setError(t('teachingRecording.no_microphone'));
    }
  }
  // Pause keeps what was recorded so far; Continue carries on in the same recording; Stop ends it.
  function pause() {
    try {
      recorder.current?.pause();
      setPaused(true);
    } catch {
      /* not supported by this browser: Stop still works */
    }
  }
  function resume() {
    try {
      recorder.current?.resume();
      setPaused(false);
    } catch {
      /* ignore */
    }
  }
  function stop() {
    recorder.current?.stop();
    if (timer.current) window.clearInterval(timer.current);
    setRecording(false);
    setPaused(false);
  }
  function pickFile(file: File | undefined) {
    if (!file) return;
    const mime = baseMime(file.type);
    if (!ALLOWED.includes(mime)) return setError(t('teachingRecording.bad_type'));
    setError('');
    setClip({ blob: file, url: URL.createObjectURL(file), mime });
  }

  async function useClip() {
    if (!clip) return;
    setBusy(true);
    setError('');
    try {
      const auth = await api.post<{ storageKey: string; uploadUrl: string }>('/api/member/teaching-rota/recordings/authorize', { weekStart: week.weekStart, mimeType: clip.mime, byteSize: clip.blob.size });
      const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': clip.mime }, body: clip.blob });
      if (!put.ok) throw new Error('upload failed');
      // With a recording already made, this is the next part; with none, it is part 1.
      const saved = await api.post<RecordingWeek>(rec ? '/api/member/teaching-rota/recordings/parts' : '/api/member/teaching-rota/recordings', { weekStart: week.weekStart, storageKey: auth.storageKey, mimeType: clip.mime, byteSize: clip.blob.size });
      setClip(null);
      onChanged(saved);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    if (!window.confirm(t('teachingRecording.confirm_start_over') ?? '')) return;
    setBusy(true);
    setError('');
    try {
      onChanged(await api.delete<RecordingWeek>(`/api/member/teaching-rota/recordings/${week.weekStart}`));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const language = rec?.spokenLanguage === 'fr' ? 'Français' : rec?.spokenLanguage === 'en' ? 'English' : '';
  // A next part can be recorded at any time before the teaching time, even while the text of the last one is still being written.
  const showClipTools = week.canChange && groupChosen;
  // What to do next, said plainly, so the parts are done in order.
  const guide = !last
    ? t('teachingRecording.guide_first')
    : last.state === 'writing'
      ? t('teachingRecording.guide_writing', { n: last.n, next })
      : last.state === 'approved'
        ? t('teachingRecording.guide_done', { n: last.n, next })
        : t('teachingRecording.guide_check', { n: last.n, next });

  return (
    <section className="card space-y-3" data-testid={`recording-${week.weekStart}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('teachingRecording.title')}</p>
        <p className="text-sm text-slate-700">
          {t('teachingRecording.posts_at', { when: when.cameroon })} <span className="text-slate-500">({t('teachingRota.cameroon_time')})</span>
        </p>
      </div>

      {!groupChosen && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('teachingRecording.no_group')}</p>}
      {groupChosen && !week.canChange && !rec && <p className="text-sm text-slate-600">{t('teachingRecording.too_late')}</p>}

      {rec?.status === 'POSTED' && <p className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800" data-testid="recording-posted">✓ {t('teachingRecording.posted')}</p>}

      {rec && rec.status !== 'POSTED' && (
        <div className="space-y-3" data-testid="recording-parts">
          {parts.map((part) => (
            <PartCard key={part.id ?? 'first'} part={part} week={week} language={language} onChanged={onChanged} />
          ))}
        </div>
      )}

      {showClipTools && !clip && !recording && (
        <div className="space-y-2 rounded-xl bg-brand-50 p-3" data-testid="recording-next">
          <p className="text-sm text-brand-900" data-testid="recording-guide">{guide}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" onClick={() => void start()} data-testid="recording-start">
              🎙 {t('teachingRecording.record_part', { n: next })}
            </button>
            <label className="cursor-pointer text-sm font-semibold text-brand-700 underline">
              {t('teachingRecording.choose_file_part', { n: next })}
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="recording-file" />
            </label>
            {rec && (
              <button type="button" className="ml-auto text-sm font-semibold text-red-700 underline" disabled={busy} onClick={() => void startOver()} data-testid="recording-delete">
                {t('teachingRecording.start_over')}
              </button>
            )}
          </div>
        </div>
      )}
      {recording && (
        <div className="flex flex-wrap items-center gap-3" data-testid="recording-live">
          <span className="w-full text-sm font-semibold text-slate-700">{t('teachingRecording.part_n', { n: next })}</span>
          <span className={`font-mono text-lg ${paused ? 'text-amber-700' : 'text-red-700'}`}>{paused ? '⏸' : '●'} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
          {paused ? (
            <button type="button" className="btn-primary" onClick={resume} data-testid="recording-resume">
              ▶ {t('teachingRecording.resume')}
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={pause} data-testid="recording-pause">
              ⏸ {t('teachingRecording.pause')}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={stop} data-testid="recording-stop">
            ■ {t('teachingRecording.stop')}
          </button>
          {paused && <span className="w-full text-xs text-slate-600">{t('teachingRecording.paused_note')}</span>}
        </div>
      )}
      {clip && (
        <div className="space-y-2" data-testid="recording-preview">
          <p className="text-sm font-semibold text-slate-700">{t('teachingRecording.part_n', { n: next })}</p>
          <audio controls src={clip.url} className="w-full" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void useClip()} data-testid="recording-use">
              {busy ? t('teachingRecording.sending') : t('teachingRecording.use_as_part', { n: next })}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setClip(null)}>
              {t('teachingRecording.discard')}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700" data-testid="recording-error">{error}</p>}
    </section>
  );
}

export function TeachingRecordingPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<RecordingsResponse | null>(null);
  const load = useCallback(
    () =>
      api
        .get<RecordingsResponse>('/api/member/teaching-rota/recordings')
        .then((r) => setData(r && Array.isArray(r.weeks) && r.weeks.every((w) => typeof w.postsAt === 'string') ? r : null))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // While the text is being written (or the other language made), look again every few seconds.
  const waiting = data?.weeks.some((w) => w.recording && w.recording.status !== 'POSTED' && partsOf(w.recording).some((p) => p.state === 'writing' || (p.state === 'approved' && !p.translated)));
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  if (!data || !data.enabled || !data.isTeacher) return null;
  return (
    <div className="space-y-3" data-testid="recording-panel">
      <h2 className="text-lg font-bold text-brand-900">{t('teachingRecording.heading')}</h2>
      <p className="text-sm text-slate-600">{t('teachingRecording.intro')}</p>
      {data.weeks.map((w) => (
        <WeekRecording key={w.weekStart} week={w} groupChosen={data.groupChosen} onChanged={(next) => setData((d) => (d ? { ...d, weeks: d.weeks.map((x) => (x.weekStart === next.weekStart ? next : x)) } : d))} />
      ))}
    </div>
  );
}
