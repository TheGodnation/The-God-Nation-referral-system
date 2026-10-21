import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { loadPdfJs } from '../lib/loadPdfJs';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { PdfPage } from '../components/chat/PdfViewer';
import { blobBytes, bookKey, deleteSaved, getFile, isOfflineError, saveFile, updateMeta } from '../lib/offlineStore';
import { newestBookmark, readLocalBookmark, syncBookmark, writeLocalBookmark } from '../lib/readingProgress';

interface BookInfo {
  id: string;
  kind: 'DEVOTIONAL' | 'TRAINING';
  titleEn: string;
  titleFr: string | null;
  trainingOrder: number | null;
  examId: string | null;
  watermark: string;
  fileVersion?: string;
  byteSize?: number | null;
  pageCount?: number | null;
  progress?: { page: number; at: string } | null;
}

const PAGE_GAP = 12;
const SYNC_EVERY_MS = 15000;

/** Downloads the book's PDF, reporting how far it got. */
async function downloadBook(bookId: string, expectedBytes: number | null | undefined, onPercent: (p: number) => void): Promise<Blob> {
  const res = await fetch(`/api/member/library/books/${bookId}/content`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'content');
  const total = Number(res.headers.get('content-length')) || expectedBytes || 0;
  const reader = res.body?.getReader?.();
  if (!reader || !total) return new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
  const parts: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onPercent(Math.min(99, Math.round((loaded / total) * 100)));
  }
  return new Blob(parts, { type: 'application/pdf' });
}

// The in-app book reader. The book is downloaded into the app the first
// time it is opened and kept on the phone (see lib/offlineStore), so it
// opens again at once, even without internet; a new version from the admin
// replaces it. With internet, the server still checks the book is open for
// this reader each time (a copy whose book is closed again is removed).
// Pages are drawn as they come near the screen; there is no download
// button, and the reader's name and phone number are printed faintly
// across every page. The page someone is on is remembered (bookmark) and
// the book opens there next time, on any phone.
export function MemberReaderPage() {
  const { t, i18n } = useTranslation();
  const { member } = useMemberAuth();
  const ownerId = member?.personId ?? '';
  const { bookId = '' } = useParams();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'downloading' | 'ready' | 'notFound' | 'failed' | 'offlineMissing'>('loading');
  const [percent, setPercent] = useState(0);
  const [pdf, setPdf] = useState<any>(null);
  const [aspect, setAspect] = useState(1.414);
  const [width, setWidth] = useState(0);
  const [offline, setOffline] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [page, setPage] = useState(1);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const resumeRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const isFr = i18n.language.startsWith('fr');

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    let doc: any = null;
    setStatus('loading');
    (async () => {
      const key = bookKey(ownerId, bookId);
      let info: BookInfo | null = null;
      let blob: Blob | null = null;
      let usingCopy = false;
      try {
        info = await api.get<BookInfo>(`/api/member/library/books/${bookId}`);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // Closed again (or removed): its downloaded copy goes too.
          await deleteSaved([key]);
          return setStatus('notFound');
        }
        if (!isOfflineError(err)) return setStatus('failed');
        const saved = await getFile(key);
        if (!saved) return setStatus('offlineMissing');
        info = saved.meta as unknown as BookInfo;
        blob = saved.blob;
        usingCopy = true;
        setOffline(true);
      }
      if (cancelled || !info) return;
      setBook(info);
      try {
        if (!blob) {
          const saved = await getFile(key);
          if (saved && saved.version === info.fileVersion) {
            blob = saved.blob;
            void updateMeta(key, info as unknown as Record<string, unknown>);
          } else {
            setStatus('downloading');
            blob = await downloadBook(bookId, info.byteSize, (p) => !cancelled && setPercent(p));
            const kept = await saveFile({
              key,
              ownerId,
              kind: 'BOOK',
              title: info.titleEn,
              version: info.fileVersion,
              meta: info as unknown as Record<string, unknown>,
              blob,
            });
            if (!cancelled) setJustSaved(kept);
          }
        }
        // Where to open: the newest of this phone's bookmark and the server's.
        const local = readLocalBookmark(ownerId, bookId);
        const mark = newestBookmark(local, info.progress ? { page: info.progress.page, at: String(info.progress.at) } : null);
        if (local && !local.synced && !usingCopy) void syncBookmark(ownerId, bookId);
        const pdfjs = await loadPdfJs();
        doc = await pdfjs.getDocument({ data: new Uint8Array(await blobBytes(blob)) }).promise;
        if (cancelled) return;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setAspect(vp.height / vp.width);
        resumeRef.current = mark && mark.page > 1 && mark.page <= doc.numPages ? mark.page : null;
        setPdf(doc);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus(err instanceof ApiError && err.status === 404 ? 'notFound' : isOfflineError(err) ? 'offlineMissing' : 'failed');
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, ownerId]);

  useEffect(() => {
    const measure = () => setWidth(Math.min((listRef.current?.clientWidth ?? 360) - 8, 900));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const pageHeight = Math.round(width * aspect);

  // Open at the bookmark, once the pages are laid out.
  useEffect(() => {
    if (status !== 'ready' || !pdf || !width || resumeRef.current === null) return;
    const target = resumeRef.current;
    resumeRef.current = null;
    setPage(target);
    setResumedAt(target);
    // After the "Opened where you stopped" line shows, so the page's top
    // lands just below the (taller) header rather than under it.
    const frame = requestAnimationFrame(() => {
      const top = (listRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY + (target - 1) * (pageHeight + PAGE_GAP);
      window.scrollTo(0, Math.max(0, top - (headerRef.current?.offsetHeight ?? 0) - 8));
    });
    const hide = window.setTimeout(() => setResumedAt(null), 8000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(hide);
    };
  }, [status, pdf, width, pageHeight]);

  // Which page is on screen.
  useEffect(() => {
    if (!pdf || !pageHeight) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const listTop = (listRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
        const y = window.scrollY + window.innerHeight * 0.35 - listTop;
        setPage(Math.max(1, Math.min(pdf.numPages, Math.floor(y / (pageHeight + PAGE_GAP)) + 1)));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [pdf, pageHeight]);

  // Bookmark: on the phone at once, to the server every so often and when leaving.
  useEffect(() => {
    if (status !== 'ready' || !ownerId) return;
    const prev = readLocalBookmark(ownerId, bookId);
    if (prev?.page === page) return;
    writeLocalBookmark(ownerId, bookId, { page, at: new Date().toISOString(), synced: false });
  }, [page, status, ownerId, bookId]);

  useEffect(() => {
    if (status !== 'ready' || !ownerId) return;
    const send = (closing = false) => void syncBookmark(ownerId, bookId, pdf?.numPages, closing);
    const timer = window.setInterval(() => send(), SYNC_EVERY_MS);
    // The app going to the background or closing: send now, even as it closes.
    const onHide = () => document.visibilityState === 'hidden' && send(true);
    const onPageHide = () => send(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      send();
    };
  }, [status, ownerId, bookId, pdf]);

  const title = book ? (isFr ? book.titleFr || book.titleEn : book.titleEn) : '';
  const watermarkTile = book
    ? `url("data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'><text x='10' y='140' transform='rotate(-25 210 110)' font-family='sans-serif' font-size='18' fill='rgba(30,41,90,0.13)'>${book.watermark.replace(/[<>&'"]/g, '')}</text></svg>`,
      )}")`
    : 'none';
  const backTo = book?.kind === 'TRAINING' ? `/member/school/${book.id}` : '/member/learn';

  return (
    <div className="min-h-screen bg-slate-100" onContextMenu={(e) => e.preventDefault()}>
      <style>{`.reader-list canvas{display:block;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
@media print{body{display:none!important}}`}</style>
      <header ref={headerRef} className={`sticky top-0 z-10 bg-white shadow-sm ${offline ? 'pt-6' : ''}`}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link to={backTo} className="shrink-0 text-sm text-brand-700 hover:underline">
            ← {t('reader.back')}
          </Link>
          <div className="min-w-0 text-center">
            <h1 className="truncate text-sm font-semibold text-brand-900">{title}</h1>
            {pdf && <p className="text-xs text-slate-500">{t('reader.page_of', { page, count: pdf.numPages })}</p>}
          </div>
          {book?.examId && !offline ? (
            <Link to={`/member/assessments/${book.examId}`} className="btn-primary shrink-0 px-3 py-1.5 text-sm">
              {t('reader.take_exam')}
            </Link>
          ) : (
            <span />
          )}
        </div>
        {offline && <p className="bg-amber-50 px-4 py-1 text-center text-xs text-amber-900">📥 {t('reader.offline_copy')}</p>}
        {!offline && justSaved && status === 'ready' && <p className="bg-green-50 px-4 py-1 text-center text-xs text-green-800">✓ {t('reader.downloaded')}</p>}
        {resumedAt && (
          <p className="flex items-center justify-center gap-3 bg-brand-50 px-4 py-1 text-xs text-brand-900" role="status">
            {t('reader.resumed', { page: resumedAt })}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                window.scrollTo(0, 0);
                setResumedAt(null);
              }}
            >
              {t('reader.from_start')}
            </button>
          </p>
        )}
      </header>

      {status === 'loading' && <p className="py-16 text-center text-slate-500">{t('reader.loading')}</p>}
      {status === 'downloading' && (
        <p className="py-16 text-center text-slate-600" role="status">
          {t('reader.downloading', { percent })}
        </p>
      )}
      {status === 'notFound' && <p className="py-16 text-center text-slate-600">{t('reader.not_available')}</p>}
      {status === 'failed' && <p className="py-16 text-center text-red-700">{t('reader.failed')}</p>}
      {status === 'offlineMissing' && <p className="px-6 py-16 text-center text-slate-600">{t('reader.offline_missing')}</p>}

      <div className="relative px-1 py-4">
        <div ref={listRef} className="reader-list" style={{ display: 'flex', flexDirection: 'column', gap: PAGE_GAP }}>
          {status === 'ready' && pdf && width > 0 && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} number={i + 1} width={width} aspect={aspect} />)}
        </div>
        {status === 'ready' && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: watermarkTile, backgroundRepeat: 'repeat' }} />
        )}
      </div>
      {status === 'ready' && pdf && <p className="pb-8 text-center text-xs text-slate-400">{t('reader.end', { count: pdf.numPages })}</p>}
    </div>
  );
}
