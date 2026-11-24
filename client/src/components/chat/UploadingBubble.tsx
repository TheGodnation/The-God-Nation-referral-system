import { useTranslation } from 'react-i18next';
import type { MediaSendJob } from '../../lib/useMediaUploads';
import { DocumentCard } from './DocumentCard';
import { Avatar } from '../Avatar';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { BAR_COUNT, formatVoiceLength, seededBars } from './VoiceNotePlayer';

// Your own photo/video/document message while it is still going up — shown
// in the chat straight away, like WhatsApp, with a progress circle you can
// tap to stop it. If it fails: the reason, and "Try again" when trying
// again can help.
function ProgressRing({ job, onCancel, onRetry, label }: { job: MediaSendJob; onCancel: () => void; onRetry: () => void; label: string }) {
  const { t } = useTranslation();
  const r = 22;
  const length = 2 * Math.PI * r;
  const shown = Math.max(0.04, job.progress);

  if (job.status === 'failed') {
    return job.problem === 'failed' ? (
      <button
        type="button"
        onClick={onRetry}
        className="flex h-14 items-center gap-1 rounded-full bg-black/60 px-4 text-sm font-semibold text-white"
      >
        ⟳ {t('groupChat.upload_retry')}
      </button>
    ) : null;
  }

  return (
    <div
      className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/50"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(job.progress * 100)}
    >
      <svg viewBox="0 0 56 56" className={`absolute inset-0 h-14 w-14 -rotate-90 ${job.status === 'sending' ? 'animate-spin' : ''}`} aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={job.status === 'sending' ? length * 0.75 : length * (1 - shown)}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      {job.status === 'uploading' && (
        <button type="button" onClick={onCancel} aria-label={t('groupChat.upload_cancel') ?? ''} className="relative text-lg font-bold text-white">
          ✕
        </button>
      )}
    </div>
  );
}

// Your own voice note while it goes up: the same design as the finished note (your photo, the play button with the progress as
// a ring around it, the waveform and the length), so nothing jumps when it turns into the real message.
function UploadingVoice({ job, index, onCancel, onRetry, label }: { job: MediaSendJob; index: number; onCancel: () => void; onRetry: () => void; label: string }) {
  const { t } = useTranslation();
  const { member } = useMemberAuth();
  const item = job.items[index];
  const bars = seededBars(`${job.id}-${index}`);
  const r = 16;
  const length = 2 * Math.PI * r;
  const shown = Math.max(0.04, job.progress);
  const failed = job.status === 'failed';
  const sending = job.status === 'sending';
  return (
    <div className="mb-1 flex w-64 max-w-full items-center gap-2 px-1 py-1" data-testid="uploading-voice">
      <Avatar name={member?.name ?? ''} photoUrl={member?.photoUrl} size={36} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(job.progress * 100)}
        >
          {failed ? (
            job.problem === 'failed' ? (
              <button type="button" onClick={onRetry} aria-label={t('groupChat.upload_retry') ?? ''} className="text-lg leading-none">⟳</button>
            ) : (
              <span aria-hidden className="text-base leading-none">⚠️</span>
            )
          ) : (
            <>
              <svg viewBox="0 0 36 36" className={`absolute inset-0 h-9 w-9 -rotate-90 ${sending ? 'animate-spin' : ''}`} aria-hidden>
                <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
                <circle
                  cx="18"
                  cy="18"
                  r={r}
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={length}
                  strokeDashoffset={sending ? length * 0.75 : length * (1 - shown)}
                  className="transition-[stroke-dashoffset] duration-200"
                />
              </svg>
              {/* A tap on the ring stops the sending, like WhatsApp's ✕. */}
              <button type="button" onClick={onCancel} aria-label={t('groupChat.upload_cancel') ?? ''} className="relative text-sm font-bold leading-none">
                ✕
              </button>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div aria-hidden className="flex h-6 w-full min-w-[7rem] max-w-[11rem] items-center gap-[2px]">
            {bars.slice(0, BAR_COUNT).map((h, i) => (
              <span key={i} className="w-[2px] flex-1 rounded-full bg-slate-400/50" style={{ height: `${Math.round(h * 100)}%` }} />
            ))}
          </div>
          <span className="text-[11px] text-slate-500">{item?.durationMs ? formatVoiceLength(item.durationMs / 1000) : '–:––'}</span>
        </div>
      </div>
    </div>
  );
}

export function UploadingBubble({ job, onCancel, onRetry }: { job: MediaSendJob; onCancel: () => void; onRetry: () => void }) {
  const { t } = useTranslation();
  const visuals = job.items.filter((i) => i.kind === 'photo' || i.kind === 'video');
  const documents = job.items.filter((i) => i.kind === 'document');
  const voiceIndexes = job.items.flatMap((i, n) => (i.kind === 'voice' ? [n] : []));
  const failed = job.status === 'failed';
  const label = t('groupChat.upload_progress', { percent: Math.round(job.progress * 100) });

  const problem =
    job.problem === 'storage'
      ? t('groupChat.storage_off')
      : job.problem === 'size'
        ? t('groupChat.too_big')
        : job.problem === 'type'
          ? t('groupChat.wrong_type')
          : t('groupChat.upload_failed');

  return (
    <div className="flex justify-end" data-testid="uploading-bubble">
      <div className="max-w-[80%] rounded-lg rounded-br-sm bg-[#d9fdd3] p-1 shadow-sm">
        {visuals.length > 0 && (
          <div className="relative w-fit">
            <div className={`grid gap-1 ${visuals.length > 1 ? 'grid-cols-2' : ''}`}>
              {visuals.map((item, i) => (
                <div key={i} className={`overflow-hidden rounded-md bg-slate-300 ${visuals.length > 1 ? 'h-28 w-28' : 'h-56 w-56'}`}>
                  {item.previewUrl &&
                    (item.kind === 'photo' ? (
                      <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <video src={item.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ))}
                </div>
              ))}
            </div>
            <div className={`absolute inset-0 flex items-center justify-center rounded-md ${failed ? 'bg-black/40' : 'bg-black/20'}`}>
              <ProgressRing job={job} onCancel={onCancel} onRetry={onRetry} label={label} />
            </div>
          </div>
        )}

        {/* A voice note: it shows at once looking like the finished note, with a ring filling around its play button. */}
        {voiceIndexes.map((n) => (
          <UploadingVoice key={`v${n}`} job={job} index={n} onCancel={onCancel} onRetry={onRetry} label={label} />
        ))}

        {documents.map((item, i) => (
          <div key={i} className="mb-1">
            <DocumentCard
              name={item.name}
              byteSize={item.byteSize}
              pageCount={item.pageCount}
              thumb={item.thumb}
              side={
                visuals.length === 0 && i === 0 ? (
                  <span className="-m-2 block shrink-0 scale-75">
                    <ProgressRing job={job} onCancel={onCancel} onRetry={onRetry} label={label} />
                  </span>
                ) : undefined
              }
            />
          </div>
        ))}

        {job.caption && <p className="max-w-[14rem] whitespace-pre-wrap break-words px-1 pt-1 text-[15px] text-slate-900">{job.caption}</p>}

        {failed ? (
          <div className="flex items-center justify-between gap-3 px-1 pt-1">
            <p role="alert" className="max-w-[11rem] text-xs font-medium text-red-700">
              {problem}
            </p>
            <button type="button" onClick={onCancel} className="shrink-0 text-xs text-slate-600 underline">
              {t('groupChat.upload_remove')}
            </button>
          </div>
        ) : (
          <p className="px-1 pt-0.5 text-right text-[11px] text-slate-500">
            🕓 {job.status === 'sending' ? t('groupChat.sending') : `${Math.round(job.progress * 100)}%`}
          </p>
        )}
      </div>
    </div>
  );
}
