import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { baseMime, pickRecorderMime } from '../../lib/chatMedia';
import { VOICE_BITRATE, enhanceMic, openMic } from '../../lib/voiceCapture';
import { slotLabel } from './teachingTypes';

type Status = 'RECORDED' | 'WRITING' | 'TEXT_READY' | 'FAILED' | 'APPROVED' | 'POSTED';
interface RecordingWeek {
  weekStart: string;
  postsAt: string;
  canChange: boolean;
  recording: null | { status: Status; spokenLanguage: 'en' | 'fr' | null; transcript: string; translated: string; audioUrl: string | null; parts?: { audioUrl: string | null }[]; partsWithoutText?: number };
}
interface RecordingsResponse {
  enabled: boolean;
  isTeacher: boolean;
  groupChosen: boolean;
  weeks: RecordingWeek[];
}

const ALLOWED = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'];

// The teacher's own teaching recorded ahead of time. They record, read the written text in the language they spoke, correct it, and
// approve it; the other language is made automatically (they are never asked to read it). At their teaching time the recording is
// posted in the teaching group by itself.
function WeekRecording({ week, groupChosen, onChanged }: { week: RecordingWeek; groupChosen: boolean; onChanged: (w: RecordingWeek) => void }) {
  const { t, i18n } = useTranslation();
  const rec = week.recording;
  const [clip, setClip] = useState<{ blob: Blob; url: string; mime: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState(rec?.transcript ?? '');
  const [dirty, setDirty] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const when = slotLabel(week.postsAt, i18n.language);

  // The written text arrives later: show it in the box unless the teacher is already editing.
  useEffect(() => {
    if (!dirty) setText(rec?.transcript ?? '');
  }, [rec?.transcript, dirty]);
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
      // The teaching is recorded after a gentle clean-up (even, loud, never crackling) at a better quality than the default.
      const enhanced = enhanceMic(stream);
      const r = new MediaRecorder(enhanced.stream, mime ? { mimeType: mime, audioBitsPerSecond: VOICE_BITRATE } : { audioBitsPerSecond: VOICE_BITRATE });
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
      // With a recording already made, this is one more part after it; with none, it is the recording itself.
      const saved = await api.post<RecordingWeek>(rec ? '/api/member/teaching-rota/recordings/parts' : '/api/member/teaching-rota/recordings', { weekStart: week.weekStart, storageKey: auth.storageKey, mimeType: clip.mime, byteSize: clip.blob.size });
      setClip(null);
      setDirty(false);
      onChanged(saved);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function call<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      after?.(r);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const base = `/api/member/teaching-rota/recordings/${week.weekStart}`;
  const saveText = () => call(() => api.put<RecordingWeek>(`${base}/transcript`, { text }), (w) => { setDirty(false); onChanged(w); });
  const approve = () =>
    call(async () => {
      if (dirty || text !== (rec?.transcript ?? '')) await api.put<RecordingWeek>(`${base}/transcript`, { text });
      return api.post<RecordingWeek>(`${base}/approve`, {});
    }, (w) => { setDirty(false); onChanged(w); });
  const retry = () => call(() => api.post<RecordingWeek>(`${base}/retry`, {}), onChanged);
  const remove = () => {
    if (!window.confirm(t('teachingRecording.confirm_start_over') ?? '')) return;
    void call(() => api.delete<RecordingWeek>(base), (w) => { setText(''); setDirty(false); onChanged(w); });
  };

  const language = rec?.spokenLanguage === 'fr' ? 'Français' : rec?.spokenLanguage === 'en' ? 'English' : '';
  const writing = rec && (rec.status === 'RECORDED' || rec.status === 'WRITING');
  // More can be added at any time before the teaching time, even while the words are still being written.
  const showClipTools = week.canChange && groupChosen;

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

      {rec && rec.status !== 'POSTED' && (rec.parts?.length ?? 0) > 1 && (
        <div className="space-y-2" data-testid="recording-parts">
          {rec.parts!.map((part, i) =>
            part.audioUrl ? (
              <div key={i}>
                <p className="text-xs font-semibold text-slate-600">{t('teachingRecording.part_n', { n: i + 1 })}</p>
                <audio controls src={part.audioUrl} className="w-full" aria-label={t('teachingRecording.part_n', { n: i + 1 }) ?? ''} />
              </div>
            ) : null,
          )}
        </div>
      )}
      {rec && rec.status !== 'POSTED' && (rec.parts?.length ?? 0) <= 1 && rec.audioUrl && (
        <audio controls src={rec.audioUrl} className="w-full" aria-label={t('teachingRecording.listen') ?? ''} />
      )}

      {writing && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="recording-writing">⏳ {t('teachingRecording.writing')}</p>}

      {rec && (rec.status === 'FAILED' || rec.status === 'TEXT_READY' || rec.status === 'APPROVED') && week.canChange && (
        <div className="space-y-2">
          {(rec.partsWithoutText ?? 0) > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="recording-parts-failed">{t('teachingRecording.parts_failed', { count: rec.partsWithoutText })}</p>}
          {rec.status === 'FAILED' && !rec.transcript && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="recording-failed">{t('teachingRecording.text_failed')}</p>}
          <label className="block text-sm font-semibold text-slate-800" htmlFor={`rec-text-${week.weekStart}`}>
            {language ? t('teachingRecording.text_in', { language }) : t('teachingRecording.text_label')}
          </label>
          <p className="text-xs text-slate-600">{t('teachingRecording.correct_help')}</p>
          <textarea
            id={`rec-text-${week.weekStart}`}
            className="input min-h-[12rem] w-full"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            data-testid="recording-text"
          />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => void saveText()} data-testid="recording-save">
              {t('teachingRecording.save_text')}
            </button>
            <button type="button" className="btn-primary" disabled={busy || !text.trim() || (rec.status === 'APPROVED' && !dirty)} onClick={() => void approve()} data-testid="recording-approve">
              ✓ {t('teachingRecording.approve')}
            </button>
          </div>
          {(rec.status === 'FAILED' || (rec.partsWithoutText ?? 0) > 0) && (
            <button type="button" className="text-sm font-semibold text-brand-700 underline" disabled={busy} onClick={() => void retry()} data-testid="recording-retry">
              {t('teachingRecording.try_again')}
            </button>
          )}
        </div>
      )}

      {rec?.status === 'APPROVED' && !dirty && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" data-testid="recording-approved">
          ✓ {t('teachingRecording.approved')} {rec.translated ? t('teachingRecording.translated_ready') : t('teachingRecording.translating')}
        </p>
      )}

      {showClipTools && !clip && !recording && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={() => void start()} data-testid="recording-start">
            🎙 {rec ? t('teachingRecording.add_more') : t('teachingRecording.record')}
          </button>
          <label className="cursor-pointer text-sm font-semibold text-brand-700 underline">
            {rec ? t('teachingRecording.add_file') : t('teachingRecording.choose_file')}
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="recording-file" />
          </label>
          {rec && (
            <button type="button" className="ml-auto text-sm font-semibold text-red-700 underline" disabled={busy} onClick={remove} data-testid="recording-delete">
              {t('teachingRecording.start_over')}
            </button>
          )}
        </div>
      )}
      {recording && (
        <div className="flex flex-wrap items-center gap-3" data-testid="recording-live">
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
          <audio controls src={clip.url} className="w-full" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void useClip()} data-testid="recording-use">
              {busy ? t('teachingRecording.sending') : rec ? t('teachingRecording.add_to_teaching') : t('teachingRecording.use_this')}
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
  const waiting = data?.weeks.some((w) => w.recording && (w.recording.status === 'RECORDED' || w.recording.status === 'WRITING' || (w.recording.status === 'APPROVED' && !w.recording.translated)));
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
