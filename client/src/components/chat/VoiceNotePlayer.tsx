import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';
import { formatBytes } from '../../lib/attachmentLimits';

// A WhatsApp-style voice note: the sender's photo beside a play button, a
// waveform, and the duration. There is no stored waveform anywhere in this
// app (recording never analyzes the audio, just uploads it) — the bars
// below are a deterministic pattern seeded from the attachment id, so the
// same voice note always looks the same, but it is a decoration, not a
// real amplitude reading.
//
// It always looks finished, the moment the message appears: the photo, the play button, the bars and the length (saved with the
// message) are all there before any audio has come down. While the audio is being made ready the play button turns a small ring;
// tapping it then plays the note as soon as it is ready. A note that could not be loaded shows a "try again" button.
export const BAR_COUNT = 34;

export function seededBars(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  let state = Math.abs(h) || 1;
  const next = () => {
    // A tiny, fast PRNG (mulberry32) — good enough for a decorative pattern.
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: BAR_COUNT }, () => 0.25 + next() * 0.75);
}

export function formatVoiceLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Notes up to this size are preloaded completely (a few seconds of audio), so pressing play starts at once. */
const PRELOAD_ALL_BYTES = 700 * 1024;

/** The "back" and "forward" buttons move this many seconds; the arrow keys move half as much. */
const SKIP_SECONDS = 10;
const KEY_SECONDS = 5;
/** Playback speeds, one tap on the speed button moving to the next. The last one chosen is remembered on this phone. */
const RATES = [1, 1.5, 2] as const;
const RATE_KEY = 'voice:rate';
function loadRate(): number {
  try {
    const v = Number(window.localStorage.getItem(RATE_KEY));
    return (RATES as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}
function saveRate(rate: number): void {
  try {
    window.localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // not remembered: fine
  }
}

export function VoiceNotePlayer({
  url,
  byteSize,
  durationMs,
  seedId,
  avatarName,
  avatarPhotoUrl,
  own,
  waitForTap,
  failed,
  onRequestDownload,
  onRetry,
  onBuffered,
}: {
  url: string | null;
  byteSize: number;
  /** The length saved with the message (missing on older voice notes). */
  durationMs?: number;
  seedId: string;
  avatarName: string;
  avatarPhotoUrl?: string | null;
  /** Sent voice notes keep the sender's own photo on the left; received
   * ones mirror it to the right — same left/right split as the outer
   * sent/received bubble alignment. */
  own: boolean;
  waitForTap: boolean;
  failed: boolean;
  onRequestDownload: () => void;
  /** Asks for the audio again (after a failure, or when its link stopped working). */
  onRetry?: () => void;
  /** The whole audio has come down: a copy can now be kept on this phone for listening offline. */
  onBuffered?: () => void;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const playWhenReady = useRef(false);
  const linkRetries = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // The audio itself would not load, even after fresh links: shown as "try again".
  const [broken, setBroken] = useState(false);
  // Where the finger is on the waveform while it is being dragged (in seconds); null when not dragging.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const [rate, setRate] = useState<number>(loadRate);
  const bars = useRef(seededBars(seedId)).current;
  const ready = Boolean(url);
  const showFailed = failed || broken;

  // A new attachment id (new voice note scrolled into view) resets playback state.
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [url]);
  useEffect(() => {
    linkRetries.current = 0;
    setBroken(false);
  }, [seedId]);

  // The chosen speed applies to every note, including one whose audio is only now ready.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, url]);

  // Pressed before the audio was ready: it starts by itself the moment it is.
  useEffect(() => {
    if (url && playWhenReady.current) {
      playWhenReady.current = false;
      void audioRef.current?.play().catch(() => {});
    }
  }, [url]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => {});
  }

  function pressPlay() {
    if (showFailed) {
      linkRetries.current = 0;
      setBroken(false);
      playWhenReady.current = true;
      onRetry?.();
      return;
    }
    if (!ready) {
      playWhenReady.current = true;
      return;
    }
    togglePlay();
  }

  // The length known before the audio loads (saved with the message), replaced by the audio's own once it is read.
  const known = duration > 0 ? duration : durationMs && durationMs > 0 ? durationMs / 1000 : 0;

  /** Moves the audio to this many seconds from the start (it keeps playing, or stays paused, as it was). */
  function seekToSeconds(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const to = Math.max(0, known > 0 ? Math.min(known, seconds) : seconds);
    audio.currentTime = to;
    setCurrentTime(to);
  }

  /** The second under a finger on the waveform, or null while the length is not known. */
  function secondAt(clientX: number): number | null {
    const el = barsRef.current;
    if (!el || known <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * known;
  }

  // Dragging the waveform: the time under the finger is shown large while it moves, and the audio jumps there when it is let go.
  function startScrub(e: React.PointerEvent<HTMLDivElement>) {
    const s = secondAt(e.clientX);
    if (s === null) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubbing.current = true;
    setScrub(s);
  }
  function moveScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    const s = secondAt(e.clientX);
    if (s !== null) setScrub(s);
  }
  function endScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    const s = secondAt(e.clientX);
    if (s !== null) seekToSeconds(s);
    setScrub(null);
  }
  function cancelScrub() {
    scrubbing.current = false;
    setScrub(null);
  }

  /** Stops a touch on the waveform from reaching the message around it (its swipe-to-reply and press-and-hold). */
  function keepToMe(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (audio) seekToSeconds(audio.currentTime + delta);
  }

  function nextRate() {
    const next = RATES[(RATES.findIndex((r) => r === rate) + 1) % RATES.length];
    setRate(next);
    saveRate(next);
  }

  function onSliderKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') seekToSeconds(currentTime - KEY_SECONDS);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') seekToSeconds(currentTime + KEY_SECONDS);
    else return;
    e.preventDefault();
  }

  // What the bar shows: the dragged-to second while dragging, otherwise where the audio is.
  const shown = scrub ?? currentTime;
  const progress = known > 0 ? Math.min(1, shown / known) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);
  // At rest the note's length; once it is playing, paused part-way or being dragged: "1:02 / 2:10".
  const atRest = !playing && shown === 0;
  const lengthText = known > 0 ? (atRest ? formatVoiceLength(known) : `${formatVoiceLength(shown)} / ${formatVoiceLength(known)}`) : '–:––';

  return (
    <div className={`flex items-center gap-2 py-0.5 ${own ? 'flex-row' : 'flex-row-reverse'}`}>
      <Avatar name={avatarName} photoUrl={avatarPhotoUrl} size={36} />
      {/* This inner group's own order never reverses — only the avatar's
       * side does — so the play button always sits immediately left of the
       * waveform, for both sent and received voice notes. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!ready && waitForTap ? (
          <button
            type="button"
            onClick={onRequestDownload}
            className="flex items-center gap-2 rounded-full bg-slate-900/10 px-3 py-1.5 text-sm font-medium text-slate-700"
            aria-label={t('network.download_voice', { size: formatBytes(byteSize) }) ?? ''}
          >
            ⬇ {t('groupChat.voice')} · {formatBytes(byteSize)}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={pressPlay}
              aria-label={(showFailed ? t('groupChat.voice_retry') : !ready ? t('groupChat.loading') : playing ? t('groupChat.voice_pause') : t('groupChat.voice_play')) ?? ''}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm"
            >
              {showFailed ? (
                <span aria-hidden className="text-lg leading-none">⟳</span>
              ) : !ready ? (
                // The audio is being made ready: a small ring turns around the play triangle.
                <>
                  <span aria-hidden className="ml-0.5 text-base leading-none opacity-80">▶</span>
                  <span aria-hidden className="absolute inset-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </>
              ) : playing ? (
                <span aria-hidden className="text-base leading-none">⏸</span>
              ) : (
                <span aria-hidden className="ml-0.5 text-base leading-none">▶</span>
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="relative w-full min-w-[8rem] max-w-[13rem]">
                {/* The waveform is the scrubber: a tall touch area you can drag along (the page does not scroll under the finger). */}
                <div
                  ref={barsRef}
                  {...(ready
                    ? {
                        role: 'slider',
                        tabIndex: 0,
                        'aria-label': t('groupChat.voice') ?? '',
                        'aria-valuemin': 0,
                        'aria-valuemax': Math.round(known),
                        'aria-valuenow': Math.round(shown),
                        'aria-valuetext': known > 0 ? `${formatVoiceLength(shown)} / ${formatVoiceLength(known)}` : undefined,
                      }
                    : { 'aria-hidden': true })}
                  className={`flex h-9 w-full touch-none select-none items-center gap-[2px] ${ready ? 'cursor-pointer' : 'animate-pulse'}`}
                  onPointerDown={ready ? startScrub : undefined}
                  onPointerMove={ready ? moveScrub : undefined}
                  onPointerUp={ready ? endScrub : undefined}
                  onPointerCancel={ready ? cancelScrub : undefined}
                  onKeyDown={ready ? onSliderKey : undefined}
                  // A finger on the waveform belongs to the waveform: the message around it must not also treat it as "swipe to
                  // reply" (which slides the whole message) or "press and hold" (which opens its menu).
                  onTouchStart={ready ? keepToMe : undefined}
                  onTouchMove={ready ? keepToMe : undefined}
                  onTouchEnd={ready ? keepToMe : undefined}
                  onTouchCancel={ready ? keepToMe : undefined}
                  onContextMenu={ready ? (e) => { e.stopPropagation(); e.preventDefault(); } : undefined}
                >
                  {bars.map((h, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className={`w-[2px] flex-1 rounded-full ${i < playedBars ? 'bg-[#075e54]' : 'bg-slate-400/50'}`}
                      style={{ height: `${Math.round(h * 100)}%` }}
                    />
                  ))}
                </div>
                {/* A handle that shows where you are (and grows while you drag it). */}
                {ready && known > 0 && (
                  <span
                    aria-hidden
                    data-testid="voice-thumb"
                    className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#075e54] shadow ring-2 ring-white transition-[width,height] ${scrub !== null ? 'h-5 w-5' : 'h-3.5 w-3.5'}`}
                    style={{ left: `${progress * 100}%` }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span data-testid="voice-time" className={scrub !== null ? 'text-sm font-bold text-[#075e54]' : 'text-[11px] text-slate-500'}>{lengthText}</span>
                {ready && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => skip(-SKIP_SECONDS)} aria-label={t('groupChat.voice_back', { seconds: SKIP_SECONDS }) ?? ''} data-testid="voice-back" className="rounded-full bg-slate-900/10 px-2 py-1 text-[11px] font-semibold leading-none text-slate-700">
                      −{SKIP_SECONDS}
                    </button>
                    <button type="button" onClick={() => skip(SKIP_SECONDS)} aria-label={t('groupChat.voice_forward', { seconds: SKIP_SECONDS }) ?? ''} data-testid="voice-forward" className="rounded-full bg-slate-900/10 px-2 py-1 text-[11px] font-semibold leading-none text-slate-700">
                      +{SKIP_SECONDS}
                    </button>
                    <button type="button" onClick={nextRate} aria-label={t('groupChat.voice_speed', { rate }) ?? ''} data-testid="voice-speed" className="rounded-full bg-slate-900/10 px-2 py-1 text-[11px] font-semibold leading-none text-slate-700">
                      {rate}×
                    </button>
                  </span>
                )}
              </div>
            </div>
            {url && (
              <audio
                ref={audioRef}
                src={url}
                // Small notes are preloaded completely so a tap plays at once; bigger ones only read their first bytes.
                preload={byteSize > 0 && byteSize <= PRELOAD_ALL_BYTES ? 'auto' : 'metadata'}
                className="hidden"
                onLoadedMetadata={(e) => {
                  // A recording made by the phone's recorder can report no length until it is played: then the saved one stays.
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setDuration(d);
                }}
                onDurationChange={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setDuration(d);
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onCanPlayThrough={() => onBuffered?.()}
                onError={() => {
                  // The link may simply have expired: ask for a fresh one, quietly, up to twice before showing "try again".
                  if (linkRetries.current < 2) {
                    linkRetries.current += 1;
                    onRetry?.();
                  } else setBroken(true);
                }}
                onEnded={() => {
                  setPlaying(false);
                  setCurrentTime(0);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
