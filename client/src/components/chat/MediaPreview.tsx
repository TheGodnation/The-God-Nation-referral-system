import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { baseMime } from '../../lib/chatMedia';
import { formatBytes } from '../../lib/attachmentLimits';
import { isPdf, readPdf, type PdfInfo } from '../../lib/pdfPreview';
import { ChatIcon } from './icons';

// The WhatsApp-style screen between picking photos and sending them: the
// chosen photo large, a strip of everything picked (tap to look, ✕ to drop
// one, + to add more), and a caption box with Send. Nothing is uploaded
// until Send is tapped.
// A picked PDF: its first page, once read (📄 until then, or if it can't be).
function DocumentPreview({ file }: { file: File }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<PdfInfo | null>(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    if (isPdf(file.type)) void readPdf(file).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [file]);
  const meta = [info ? t('groupChat.doc_pages', { count: info.pageCount }) : null, formatBytes(file.size), 'PDF'].filter(Boolean).join(' • ');
  return (
    <div className="flex max-h-full flex-col items-center gap-3 text-center">
      {info?.pageImage ? (
        <img src={info.pageImage} alt={file.name} className="min-h-0 max-w-full flex-1 object-contain shadow-lg" />
      ) : (
        <span className="rounded-2xl bg-white/10 px-10 py-10 text-6xl" aria-hidden>
          📄
        </span>
      )}
      <div>
        <p className="max-w-[18rem] break-words text-sm font-medium">{file.name}</p>
        <p className="text-xs text-white/60">{meta}</p>
      </div>
    </div>
  );
}

function kindOf(file: File): 'photo' | 'video' | 'document' {
  const type = baseMime(file.type);
  return type.startsWith('image/') ? 'photo' : type.startsWith('video/') ? 'video' : 'document';
}

export function MediaPreview({
  files,
  initialCaption,
  maxCaption,
  canAddMore,
  onAddMore,
  onRemove,
  onClose,
  onSend,
}: {
  files: File[];
  initialCaption: string;
  maxCaption: number;
  canAddMore: boolean;
  onAddMore: () => void;
  onRemove: (index: number) => void;
  onClose: () => void;
  onSend: (caption: string) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const [caption, setCaption] = useState(initialCaption);

  const urls = useMemo(
    () => files.map((f) => (kindOf(f) !== 'document' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL?.(u)), [urls]);

  useEffect(() => {
    if (selected >= files.length) setSelected(Math.max(0, files.length - 1));
  }, [files.length, selected]);

  const current = files[selected];
  const currentKind = current ? kindOf(current) : 'document';
  const currentUrl = urls[selected];

  return (
    <div role="dialog" aria-modal="true" aria-label={t('groupChat.preview_title') ?? ''} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button type="button" onClick={onClose} aria-label={t('groupChat.preview_close') ?? ''} className="flex h-11 w-11 items-center justify-center text-2xl">
          ✕
        </button>
        {files.length > 1 && (
          <span className="text-sm text-white/70">
            {selected + 1} / {files.length}
          </span>
        )}
        <span className="w-11" />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        {current &&
          (currentKind === 'photo' && currentUrl ? (
            <img src={currentUrl} alt={current.name} className="max-h-full max-w-full object-contain" />
          ) : currentKind === 'video' && currentUrl ? (
            <video src={currentUrl} controls playsInline className="max-h-full max-w-full" />
          ) : (
            <DocumentPreview file={current} />
          ))}
      </div>

      {(files.length > 1 || canAddMore) && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSelected(i)}
                aria-label={t('groupChat.preview_show', { name: f.name }) ?? ''}
                aria-pressed={i === selected}
                className={`block h-14 w-14 overflow-hidden rounded-md border-2 ${i === selected ? 'border-emerald-400' : 'border-transparent'}`}
              >
                {urls[i] && kindOf(f) === 'photo' ? (
                  <img src={urls[i]!} alt="" className="h-full w-full object-cover" />
                ) : urls[i] && kindOf(f) === 'video' ? (
                  <video src={urls[i]!} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-white/10 text-2xl">📄</span>
                )}
              </button>
              {i === selected && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={t('groupChat.preview_remove', { name: f.name }) ?? ''}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px]"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {canAddMore && (
            <button
              type="button"
              onClick={onAddMore}
              aria-label={t('groupChat.preview_add_more') ?? ''}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border-2 border-white/40 text-3xl text-white/80"
            >
              +
            </button>
          )}
        </div>
      )}

      <form
        className="flex items-end gap-2 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(caption.trim());
        }}
      >
        <textarea
          rows={1}
          value={caption}
          maxLength={maxCaption}
          onChange={(e) => {
            setCaption(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          placeholder={t('groupChat.preview_caption') ?? ''}
          aria-label={t('groupChat.preview_caption') ?? ''}
          className="min-h-[48px] min-w-0 max-h-[120px] flex-1 resize-none rounded-3xl border-0 bg-white/15 px-4 py-3 text-[16px] leading-6 text-white placeholder:text-white/60 outline-none focus:ring-0"
        />
        <button
          type="submit"
          aria-label={t('groupChat.send') ?? ''}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
        >
          <ChatIcon name="send" />
        </button>
      </form>
    </div>
  );
}
