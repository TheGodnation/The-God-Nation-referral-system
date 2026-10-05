import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration, pickRecorderMime } from '../../lib/chatMedia';

const MAX_VIDEO_MS = 60 * 1000;

// Full-screen camera to record a short video (up to 1 minute), like
// WhatsApp. Recorded small (about 640px) so it sends fast on mobile data.
export function VideoRecorder({ onDone, onClose }: { onDone: (blob: Blob) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (result) return;
    let cancelled = false;
    setError(null);
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stopStream();
        streamRef.current = stream;
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          liveRef.current.play().catch(() => {});
        }
      })
      .catch(() => !cancelled && setError(t('groupChat.camera_denied')));
    if (!navigator.mediaDevices) setError(t('groupChat.no_recording'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, result]);

  useEffect(() => () => stopStream(), []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const ms = Date.now() - startedRef.current;
      setElapsed(ms);
      if (ms >= MAX_VIDEO_MS) stop();
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function start() {
    const stream = streamRef.current;
    const mime = pickRecorderMime('video');
    if (!stream || !mime) {
      setError(t('groupChat.no_recording'));
      return;
    }
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 });
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      stopStream();
      setResult({ blob, url: URL.createObjectURL(blob) });
    };
    recorderRef.current = rec;
    rec.start(1000);
    startedRef.current = Date.now();
    setElapsed(0);
    setRecording(true);
  }

  function stop() {
    setRecording(false);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }

  function retake() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  }

  function close() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    stopStream();
    if (result) URL.revokeObjectURL(result.url);
    onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('groupChat.video_title') ?? ''} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={close} className="text-lg" aria-label={t('groupChat.close') ?? ''}>
          ✕
        </button>
        <span className="text-sm">{recording ? `● ${formatDuration(elapsed)} / 1:00` : t('groupChat.video_max')}</span>
        {!result && !recording ? (
          <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={t('groupChat.switch_camera') ?? ''}>
            🔄
          </button>
        ) : (
          <span />
        )}
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <p className="px-6 text-center">{error}</p>
        ) : result ? (
          <video src={result.url} controls playsInline className="max-h-full max-w-full" />
        ) : (
          <video ref={liveRef} muted playsInline autoPlay className={`max-h-full max-w-full ${facing === 'user' ? '-scale-x-100' : ''}`} />
        )}
      </div>

      <div className="flex items-center justify-center gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">
        {result ? (
          <>
            <button type="button" className="rounded-full bg-white/20 px-5 py-2" onClick={retake}>
              {t('groupChat.retake')}
            </button>
            <button
              type="button"
              className="rounded-full bg-green-500 px-6 py-2 font-semibold"
              onClick={() => {
                onDone(result.blob);
                URL.revokeObjectURL(result.url);
              }}
            >
              {t('groupChat.use_video')}
            </button>
          </>
        ) : !error ? (
          <button
            type="button"
            onClick={recording ? stop : start}
            aria-label={(recording ? t('groupChat.stop_rec') : t('groupChat.start_rec')) ?? ''}
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white"
          >
            <span className={recording ? 'h-6 w-6 rounded bg-red-500' : 'h-12 w-12 rounded-full bg-red-500'} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
