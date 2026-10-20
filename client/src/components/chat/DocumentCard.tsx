import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../lib/attachmentLimits';

// A document in a chat bubble, the way WhatsApp shows a PDF: the top of its
// first page as a banner, then the file name and "71 pages • 3.5 MB • PDF".
// `side` holds the progress circle while it is still being sent.
export function DocumentCard({
  name,
  byteSize,
  pageCount,
  thumb,
  side,
}: {
  name: string;
  byteSize: number;
  pageCount?: number;
  thumb?: string;
  side?: ReactNode;
}) {
  const { t } = useTranslation();
  const ext = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'pdf').toUpperCase();
  const meta = [pageCount ? t('groupChat.doc_pages', { count: pageCount }) : null, formatBytes(byteSize), ext].filter(Boolean).join(' • ');

  return (
    <span className="block w-64 max-w-full overflow-hidden rounded-md bg-slate-900/5 text-left">
      {thumb && (
        <span className="block h-24 w-full overflow-hidden bg-white">
          <img src={thumb} alt="" aria-hidden className="h-full w-full object-cover object-top" />
        </span>
      )}
      <span className="flex items-center gap-2 px-2 py-2">
        <span aria-hidden className="flex h-9 w-7 shrink-0 items-end justify-center rounded-sm bg-red-600 pb-0.5 text-[8px] font-bold text-white">
          {ext}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-sm font-medium text-slate-800">{name}</span>
          <span className="block text-xs text-slate-500">{meta}</span>
        </span>
        {side}
      </span>
    </span>
  );
}
