// Makes a shared post's picture the right size for where it is shown. WhatsApp shows a link card's picture only when it is small
// (about 300 KB), and Facebook wants about 1200x630, so the card picture is always cut to exactly that, whatever the original size
// or shape. The pictures on the shared page are scaled down too, so the page opens quickly on a phone.
// The image tool (sharp) is loaded only when needed; if it cannot be loaded the server still runs and the old behaviour is used.

type SharpFactory = (input?: Buffer) => {
  rotate(): ReturnType<SharpFactory>;
  resize(options: { width?: number; height?: number; fit?: 'cover' | 'inside'; withoutEnlargement?: boolean }): ReturnType<SharpFactory>;
  jpeg(options: { quality: number; mozjpeg?: boolean }): ReturnType<SharpFactory>;
  flatten(options: { background: string }): ReturnType<SharpFactory>;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number }>;
};

let loaded: SharpFactory | null | undefined;

async function getSharp(): Promise<SharpFactory | null> {
  if (loaded === undefined) {
    try {
      const mod = (await import('sharp')) as unknown as { default?: SharpFactory };
      loaded = (mod.default ?? (mod as unknown as SharpFactory)) || null;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

export async function isPhotoResizingAvailable(): Promise<boolean> {
  return (await getSharp()) !== null;
}

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const CARD_TARGET_BYTES = 280 * 1024;
/** A picture bigger than this is not even opened (it would take too much memory). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** The picture as a 1200x630 JPEG of at most about 280 KB (cut from the middle, turned the right way up). Null when it cannot be done. */
export async function cardJpeg(input: Buffer): Promise<Buffer | null> {
  const sharp = await getSharp();
  if (!sharp || input.length > MAX_INPUT_BYTES) return null;
  try {
    let out: Buffer = Buffer.alloc(0);
    for (const quality of [80, 68, 56, 45]) {
      out = await sharp(input).rotate().flatten({ background: '#ffffff' }).resize({ width: CARD_WIDTH, height: CARD_HEIGHT, fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.length <= CARD_TARGET_BYTES) break;
    }
    return out;
  } catch {
    return null;
  }
}

/** The picture scaled to fit 1280 pixels wide at most (never enlarged), as a JPEG, for the shared page. Null when it cannot be done. */
export async function pageJpeg(input: Buffer): Promise<Buffer | null> {
  const sharp = await getSharp();
  if (!sharp || input.length > MAX_INPUT_BYTES) return null;
  try {
    return await sharp(input).rotate().flatten({ background: '#ffffff' }).resize({ width: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}

/** Like pageJpeg, with the finished picture's width and height (for the website, which reserves the picture's space). */
export async function pageJpegInfo(input: Buffer): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  const bytes = await pageJpeg(input);
  if (!bytes) return null;
  const sharp = await getSharp();
  try {
    const meta = await sharp!(bytes).metadata();
    return meta.width && meta.height ? { bytes, width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}
