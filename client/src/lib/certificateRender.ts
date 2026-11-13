// The Academy diploma is drawn on a blank copy of the design (public/certificate/blank-en.png, blank-fr.png): only the
// student's name, the date of issue and the certificate number are written on top. The same drawing is used for the
// picture on the screen and for the downloaded file, so what the admin checks is what the student gets.
//
// All positions are measured on the 1536 x 1024 design; if a sharper copy of the design is put in the same place, the
// drawing scales to it.

export type CertLang = 'en' | 'fr';

export interface CertificateData {
  name: string;
  /** GNLA-2026-001 */
  number: string;
  issuedAt: Date | string;
  lang: CertLang;
}

export const DESIGN_WIDTH = 1536;
export const DESIGN_HEIGHT = 1024;

const NAME_FONT = '"CertScript", "Brush Script MT", cursive';
const TEXT_FONT = '"Times New Roman", Times, serif';
const NAME_COLOR = '#15266f';
const TEXT_COLOR = '#10194d';

// How each language is laid out (sizes and left edges measured on the designs).
const LAYOUT = {
  en: { dateX: 152, dateSize: 33, numberX: 146, numberSize: 33 },
  fr: { dateX: 158, dateSize: 41, numberX: 144, numberSize: 35 },
} as const;

export function templateUrl(lang: CertLang): string {
  return `/certificate/blank-${lang}.png`;
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The day, month and year in Cameroon time, whatever the device's clock zone. */
function dayMonthYear(value: Date | string): { day: number; month: number; year: number } {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Douala', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { day: get('day'), month: get('month'), year: get('year') };
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "Issued on this 30th of October, 2026" / "Délivré le 30 octobre 2026" */
export function issuedLine(value: Date | string, lang: CertLang): string {
  const { day, month, year } = dayMonthYear(value);
  return lang === 'fr' ? `Délivré le ${day === 1 ? '1er' : day} ${MONTHS_FR[month - 1]} ${year}` : `Issued on this ${ordinal(day)} of ${MONTHS_EN[month - 1]}, ${year}`;
}

/** "Certificate No.: GNLA-2026-001" / "Certificat N° : GNLA-2026-001" */
export function numberLine(number: string, lang: CertLang): string {
  return lang === 'fr' ? `Certificat N° : ${number}` : `Certificate No.: ${number}`;
}

let fontReady: Promise<void> | null = null;
/** Loads the script font used for the name (once). If it cannot load, a cursive font of the device is used. */
export function loadCertificateFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      try {
        const face = new FontFace('CertScript', 'url(/fonts/playball-latin.woff2)');
        await face.load();
        document.fonts.add(face);
      } catch {
        /* the fallback cursive font is used */
      }
    })();
  }
  return fontReady;
}

const images = new Map<CertLang, Promise<HTMLImageElement>>();
export function loadTemplate(lang: CertLang): Promise<HTMLImageElement> {
  let found = images.get(lang);
  if (!found) {
    found = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('template'));
      img.src = templateUrl(lang);
    });
    images.set(lang, found);
    found.catch(() => images.delete(lang));
  }
  return found;
}

/** Draws the finished certificate on a canvas (resized to the design). */
export function drawCertificate(canvas: HTMLCanvasElement, img: HTMLImageElement, data: CertificateData): void {
  const width = img.naturalWidth || DESIGN_WIDTH;
  const height = img.naturalHeight || DESIGN_HEIGHT;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const k = width / DESIGN_WIDTH;
  const layout = LAYOUT[data.lang];
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = 'alphabetic';

  // The name: centred between the two lines, shrunk if it is long so it never runs into the borders.
  const name = data.name.trim();
  if (name) {
    const sx = 1.4;
    let size = 104 * k;
    ctx.font = `${size}px ${NAME_FONT}`;
    while (ctx.measureText(name).width * sx > 880 * k && size > 40 * k) {
      size -= 2 * k;
      ctx.font = `${size}px ${NAME_FONT}`;
    }
    ctx.save();
    ctx.translate((DESIGN_WIDTH / 2) * k, 424 * k);
    ctx.scale(sx, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = NAME_COLOR;
    ctx.strokeStyle = NAME_COLOR;
    ctx.lineWidth = 1.2 * k;
    ctx.fillText(name, 0, 0);
    ctx.strokeText(name, 0, 0);
    ctx.restore();
  }

  const write = (text: string, x: number, y: number, size: number) => {
    ctx.save();
    ctx.translate(x * k, y * k);
    ctx.scale(0.85, 1);
    ctx.textAlign = 'left';
    ctx.font = `bold ${size * k}px ${TEXT_FONT}`;
    ctx.fillStyle = TEXT_COLOR;
    ctx.strokeStyle = TEXT_COLOR;
    ctx.lineWidth = 0.7 * k;
    ctx.fillText(text, 0, 0);
    ctx.strokeText(text, 0, 0);
    ctx.restore();
  };
  write(issuedLine(data.issuedAt, data.lang), layout.dateX, 725, layout.dateSize);
  write(numberLine(data.number, data.lang), layout.numberX, 788, layout.numberSize);
}

/** The finished certificate as a PNG file. */
export async function certificateBlob(data: CertificateData): Promise<Blob> {
  const [img] = await Promise.all([loadTemplate(data.lang), loadCertificateFont()]);
  const canvas = document.createElement('canvas');
  drawCertificate(canvas, img, data);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png'));
}

/** A safe file name: GNLA-2026-001-nji-clinton.png */
export function certificateFileName(data: Pick<CertificateData, 'name' | 'number'>): string {
  const slug = data.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${data.number}${slug ? `-${slug}` : ''}.png`;
}
