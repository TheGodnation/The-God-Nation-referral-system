import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadPdfJs } from '../../lib/loadPdfJs';

// Opens a PDF from a chat right inside the app, page after page, like
// WhatsApp's viewer — phones often can't show a PDF link themselves and just
// download it. Pages are drawn only when they come near the screen and are
// let go again when far away, so a 70-page PDF doesn't fill the phone's
// memory. If the PDF can't be opened here, a button opens it the phone's own
// way instead.
function PdfPage({ pdf, number, width, aspect }: { pdf: any; number: number; width: number; aspect: number }) {
  const { t } = useTranslation();
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = holderRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '150% 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || !width) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      try {
        const page = await pdf.getPage(number);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * Math.min(window.devicePixelRatio || 1, 2) });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
        await task.promise;
      } catch {
        // A page that fails to draw stays blank; the others still show.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
      // Far from the screen again: free the memory.
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [near, pdf, number, width]);

  return (
    <div ref={holderRef} className="mx-auto bg-white shadow" style={{ width, height: Math.round(width * aspect) }}>
      <canvas ref={canvasRef} aria-label={t('reader.page', { number }) ?? ''} className="h-full w-full" />
    </div>
  );
}

export function PdfViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState<any>(null);
  const [aspect, setAspect] = useState(1.414);
  const [percent, setPercent] = useState(0);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let task: any = null;
    let doc: any = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        task = pdfjs.getDocument({ url });
        task.onProgress = (p: { loaded: number; total: number }) => {
          if (alive && p.total) setPercent(Math.min(99, Math.round((p.loaded / p.total) * 100)));
        };
        doc = await task.promise;
        if (!alive) return;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (!alive) return;
        setAspect(vp.height / vp.width);
        setPdf(doc);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      task?.destroy?.();
      doc?.destroy?.();
    };
  }, [url]);

  useEffect(() => {
    const measure = () => setWidth(Math.min((listRef.current?.clientWidth ?? 360) - 16, 900));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <header className="flex items-center gap-2 bg-white px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow">
        <button type="button" onClick={onClose} aria-label={t('groupChat.doc_back') ?? ''} className="flex h-11 w-11 items-center justify-center text-2xl text-slate-700">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{name}</p>
          {pdf && <p className="text-xs text-slate-500">{t('groupChat.doc_pages', { count: pdf.numPages })}</p>}
        </div>
        <a href={url} target="_blank" rel="noopener" className="rounded-full px-3 py-2 text-sm font-medium text-emerald-700">
          {t('groupChat.doc_download')}
        </a>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-2">
        {failed ? (
          <div className="mx-auto mt-16 max-w-xs space-y-3 text-center" role="alert">
            <p className="text-sm text-slate-700">{t('groupChat.doc_cannot_show')}</p>
            <a href={url} target="_blank" rel="noopener" className="inline-block rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white">
              {t('groupChat.doc_open_phone')}
            </a>
          </div>
        ) : !pdf ? (
          <p className="mt-16 text-center text-sm text-slate-600" role="status">
            {t('groupChat.doc_opening', { percent })}
          </p>
        ) : (
          Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} number={i + 1} width={width} aspect={aspect} />)
        )}
      </div>
    </div>
  );
}
