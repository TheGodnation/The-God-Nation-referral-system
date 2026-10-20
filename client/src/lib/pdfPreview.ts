import { loadPdfJs } from './loadPdfJs';

// What a PDF bubble shows, WhatsApp style: a picture of the top of its first
// page and "71 pages • 3.5 MB • PDF". Worked out on the sender's phone when
// the PDF is picked (nobody else has to download it to see the preview), and
// kept small enough to travel with the message (see the server's
// MAX_THUMB_DATA_URL_LENGTH). Best effort: on a very slow connection, or a
// PDF that can't be read, the bubble simply shows the file name and size.
export interface PdfInfo {
  pageCount: number;
  /** The top of page 1, small (base64 JPEG) — sent with the message. */
  thumb?: string;
  /** Page 1 whole, for the preview screen before sending (stays on this phone). */
  pageImage?: string;
}

const MAX_THUMB_CHARS = 15000;
const THUMB_WIDTH = 360;
const THUMB_HEIGHT = 135; // WhatsApp's wide banner, about 8:3
const PAGE_IMAGE_WIDTH = 720;
const GIVE_UP_MS = 20000;

const cache = new WeakMap<Blob, Promise<PdfInfo | null>>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        window.clearTimeout(id);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(id);
        reject(e);
      },
    );
  });
}

function smallJpeg(canvas: HTMLCanvasElement): string | undefined {
  for (const quality of [0.7, 0.55, 0.4, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.startsWith('data:image/jpeg') && url.length <= MAX_THUMB_CHARS) return url;
  }
  return undefined;
}

async function read(file: Blob): Promise<PdfInfo | null> {
  if (typeof document === 'undefined') return null;
  try {
    const pdfjs = await withTimeout(loadPdfJs(), GIVE_UP_MS);
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await withTimeout(pdfjs.getDocument({ data }).promise as Promise<any>, GIVE_UP_MS);
    const info: PdfInfo = { pageCount: pdf.numPages };
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PAGE_IMAGE_WIDTH / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        info.pageImage = canvas.toDataURL('image/jpeg', 0.8);

        // The banner: the page's top, scaled down to THUMB_WIDTH.
        const banner = document.createElement('canvas');
        banner.width = THUMB_WIDTH;
        banner.height = THUMB_HEIGHT;
        const sourceHeight = Math.min(canvas.height, (canvas.width * THUMB_HEIGHT) / THUMB_WIDTH);
        banner.getContext('2d')?.drawImage(canvas, 0, 0, canvas.width, sourceHeight, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        info.thumb = smallJpeg(banner);
      }
    } catch {
      // The page count alone is still worth showing.
    }
    pdf.destroy?.();
    return info;
  } catch {
    return null;
  }
}

export function readPdf(file: Blob): Promise<PdfInfo | null> {
  let p = cache.get(file);
  if (!p) {
    p = read(file);
    cache.set(file, p);
  }
  return p;
}

export function isPdf(type: string | null | undefined): boolean {
  return (type ?? '').split(';')[0].trim().toLowerCase() === 'application/pdf';
}
