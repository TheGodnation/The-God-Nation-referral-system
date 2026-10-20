import { useTranslation } from 'react-i18next';
import type { MediaSendJob } from '../../lib/useMediaUploads';

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

export function UploadingBubble({ job, onCancel, onRetry }: { job: MediaSendJob; onCancel: () => void; onRetry: () => void }) {
  const { t } = useTranslation();
  const visuals = job.items.filter((i) => i.kind !== 'document');
  const documents = job.items.filter((i) => i.kind === 'document');
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

        {documents.map((item, i) => (
          <div key={i} className="mb-1 flex items-center gap-2 rounded-md bg-slate-900/5 p-2">
            <span className="text-2xl" aria-hidden>
              📄
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{item.name}</span>
            {visuals.length === 0 && i === 0 && (
              <div className="scale-75">
                <ProgressRing job={job} onCancel={onCancel} onRetry={onRetry} label={label} />
              </div>
            )}
          </div>
        ))}

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
