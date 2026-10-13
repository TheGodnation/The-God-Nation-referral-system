// Loads Mozilla's PDF.js from a public CDN the first time a book is opened
// (so members who never open a book never download it). Resolves to the
// global `pdfjsLib`, or rejects if it can't be loaded.

const VERSION = '3.11.174';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}`;

let loading: Promise<any> | null = null;

export function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}/pdf.min.js`;
    script.async = true;
    script.onload = () => {
      if (!w.pdfjsLib) return reject(new Error('PDF.js missing'));
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.js`;
      resolve(w.pdfjsLib);
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('PDF.js failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
