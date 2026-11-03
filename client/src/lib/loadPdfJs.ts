// Loads Mozilla's PDF.js the first time a book is opened (so members who never
// open a book never download it). Resolves to the global `pdfjsLib`, or rejects
// if it can't be loaded.
//
// The engine is kept WITH THE APP (public/pdfjs/<version>/, from the official
// package, unmodified), not on a public website: the phone then keeps it like
// the rest of the app (public/sw.js), so saved books open without internet and
// do not depend on a third party being reachable. The public CDN is only a
// fallback if the app's own copy cannot be fetched.

const VERSION = '3.11.174';
const BASE = `/pdfjs/${VERSION}`;
const CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}`;
/** PDF.js's worker script (kept on the phone for offline reading, see public/sw.js). */
export const PDFJS_WORKER_URL = `${BASE}/pdf.worker.min.js`;

let loading: Promise<any> | null = null;

function addScript(base: string): Promise<any> {
  const w = window as any;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}/pdf.min.js`;
    script.async = true;
    script.onload = () => {
      if (!w.pdfjsLib) return reject(new Error('PDF.js missing'));
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.js`;
      resolve(w.pdfjsLib);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('PDF.js failed to load'));
    };
    document.head.appendChild(script);
  });
}

export function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (loading) return loading;
  loading = addScript(BASE)
    .catch(() => addScript(CDN_BASE))
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
