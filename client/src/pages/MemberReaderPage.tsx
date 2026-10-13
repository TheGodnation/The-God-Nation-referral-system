import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { loadPdfJs } from '../lib/loadPdfJs';

interface BookInfo {
  id: string;
  kind: 'DEVOTIONAL' | 'TRAINING';
  titleEn: string;
  titleFr: string | null;
  trainingOrder: number | null;
  examId: string | null;
  watermark: string;
}

// The in-app book reader. Pages are drawn on screen from the PDF the server
// streams to this signed-in reader; there is no download button, and the
// reader's name and phone number are printed faintly across every page to
// discourage screenshots and photos being passed around.
export function MemberReaderPage() {
  const { t, i18n } = useTranslation();
  const { bookId = '' } = useParams();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound' | 'failed'>('loading');
  const [pageCount, setPageCount] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);
  const isFr = i18n.language.startsWith('fr');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const info = await api.get<BookInfo>(`/api/member/library/books/${bookId}`);
        if (cancelled) return;
        setBook(info);
        const [pdfjs, res] = await Promise.all([
          loadPdfJs(),
          fetch(`/api/member/library/books/${bookId}/content`, { credentials: 'include' }),
        ]);
        if (!res.ok) throw new Error('content');
        const data = new Uint8Array(await res.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled || !pagesRef.current) return;
        setPageCount(pdf.numPages);
        const container = pagesRef.current;
        container.innerHTML = '';
        const width = Math.min(container.clientWidth || 800, 900);
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.setAttribute('aria-label', t('reader.page', { number: i }) ?? '');
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          const wrap = document.createElement('div');
          wrap.className = 'reader-page';
          wrap.appendChild(canvas);
          container.appendChild(wrap);
        }
        if (!cancelled) setStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        setStatus(err?.status === 404 ? 'notFound' : 'failed');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const title = book ? (isFr ? book.titleFr || book.titleEn : book.titleEn) : '';
  const watermarkTile = book
    ? `url("data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'><text x='10' y='140' transform='rotate(-25 210 110)' font-family='sans-serif' font-size='18' fill='rgba(30,41,90,0.13)'>${book.watermark.replace(/[<>&'"]/g, '')}</text></svg>`,
      )}")`
    : 'none';

  return (
    <div className="min-h-screen bg-slate-100" onContextMenu={(e) => e.preventDefault()}>
      <style>{`.reader-page{position:relative;margin:0 auto 12px;max-width:900px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.reader-page canvas{display:block;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
@media print{body{display:none!important}}`}</style>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white px-4 py-3 shadow-sm">
        <Link to="/member/learn" className="text-sm text-brand-700 hover:underline">
          ← {t('reader.back')}
        </Link>
        <h1 className="truncate text-sm font-semibold text-brand-900">{title}</h1>
        {book?.examId ? (
          <Link to={`/member/assessments/${book.examId}`} className="btn-primary px-3 py-1.5 text-sm">
            {t('reader.take_exam')}
          </Link>
        ) : (
          <span />
        )}
      </header>

      {status === 'loading' && <p className="py-16 text-center text-slate-500">{t('reader.loading')}</p>}
      {status === 'notFound' && <p className="py-16 text-center text-slate-600">{t('reader.not_available')}</p>}
      {status === 'failed' && <p className="py-16 text-center text-red-700">{t('reader.failed')}</p>}

      <div className="relative px-2 py-4">
        <div ref={pagesRef} />
        {status === 'ready' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: watermarkTile, backgroundRepeat: 'repeat' }}
          />
        )}
      </div>
      {status === 'ready' && pageCount > 0 && <p className="pb-8 text-center text-xs text-slate-400">{t('reader.end', { count: pageCount })}</p>}
    </div>
  );
}
