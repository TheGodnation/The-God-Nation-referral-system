import { loadPdfJs } from './loadPdfJs';

// Leadership School covers, made in the admin's browser: page 1 of a book's
// PDF drawn as a picture when the PDF is uploaded, or a picture the admin
// chooses. Either way it is resized here first, so the server keeps (and
// phones download) a small JPEG — the server takes up to 300 KB.

const COVER_WIDTH = 480;
const MAX_COVER_HEIGHT = 960;
const MAX_COVER_CHARS = 400_000;

function coverJpeg(canvas: HTMLCanvasElement): string | null {
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.startsWith('data:image/jpeg') && url.length <= MAX_COVER_CHARS) return url;
  }
  return null;
}

/** The PDF's page count and page 1 as a cover picture; null when the PDF can't be read. */
export async function readPdfCover(file: Blob): Promise<{ pageCount: number; cover: string | null } | null> {
  try {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let cover: string | null = null;
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.min(Math.round(viewport.height), MAX_COVER_HEIGHT);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        cover = coverJpeg(canvas);
      }
    } catch {
      // The page count alone is still worth keeping.
    }
    const pageCount = pdf.numPages as number;
    pdf.destroy?.();
    return { pageCount, cover };
  } catch {
    return null;
  }
}

/** A chosen picture (JPEG, PNG, WebP...) resized into a cover; null when it can't be read. */
export function pictureToCover(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, COVER_WIDTH / img.naturalWidth, MAX_COVER_HEIGHT / img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(coverJpeg(canvas));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
