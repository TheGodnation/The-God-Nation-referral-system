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
const BAR_COUNT = 34;

function seededBars(seed: string): number[] {
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VoiceNotePlayer({
  url,
  byteSize,
  seedId,
  avatarName,
  avatarPhotoUrl,
  own,
  waitForTap,
  failed,
  onRequestDownload,
}: {
  url: string | null;
  byteSize: number;
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
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useRef(seededBars(seedId)).current;

  // A new attachment id (new voice note scrolled into view) resets playback state.
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [url]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play().catch(() => {});
  }

  function seekTo(clientX: number) {
    const audio = audioRef.current;
    const el = barsRef.current;
    if (!audio || !el || !duration) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = fraction * duration;
    setCurrentTime(audio.currentTime);
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);
  const remaining = playing || currentTime > 0 ? duration - currentTime : duration;

  return (
    <div className={`flex items-center gap-2 py-0.5 ${own ? 'flex-row' : 'flex-row-reverse'}`}>
      <Avatar name={avatarName} photoUrl={avatarPhotoUrl} size={36} />
      {/* This inner group's own order never reverses — only the avatar's
       * side does — so the play button always sits immediately left of the
       * waveform, for both sent and received voice notes. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {url ? (
          <>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={t(playing ? 'groupChat.voice_pause' : 'groupChat.voice_play') ?? ''}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm"
            >
              {playing ? (
                <span aria-hidden className="text-base leading-none">⏸</span>
              ) : (
                <span aria-hidden className="ml-0.5 text-base leading-none">▶</span>
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div
                ref={barsRef}
                role="slider"
                aria-label={t('groupChat.voice') ?? ''}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(currentTime)}
                className="flex h-6 w-full min-w-[7rem] max-w-[11rem] cursor-pointer items-center gap-[2px]"
                onClick={(e) => seekTo(e.clientX)}
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
              <span className="text-[11px] text-slate-500">{formatDuration(remaining)}</span>
            </div>
            <audio
              ref={audioRef}
              src={url}
              preload="metadata"
              className="hidden"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onDurationChange={(e) => {
                if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                setCurrentTime(0);
              }}
            />
          </>
        ) : waitForTap ? (
          <button
            type="button"
            onClick={onRequestDownload}
            className="flex items-center gap-2 rounded-full bg-slate-900/10 px-3 py-1.5 text-sm font-medium text-slate-700"
            aria-label={t('network.download_voice', { size: formatBytes(byteSize) }) ?? ''}
          >
            ⬇ {t('groupChat.voice')} · {formatBytes(byteSize)}
          </button>
        ) : (
          <span className="text-xs text-slate-500">{failed ? '⚠️' : t('groupChat.loading')}</span>
        )}
      </div>
    </div>
  );
}
