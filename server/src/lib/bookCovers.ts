import type { Response } from 'express';
import crypto from 'crypto';
import { prisma } from './prisma';

// Book covers for the Leadership School: small pictures kept in the
// database (LibraryBookCover). The admin's browser draws page 1 of each
// uploaded PDF as the cover (AUTO), or the admin chooses a picture
// (MANUAL); either way it arrives here already resized.

export const MAX_COVER_BYTES = 300 * 1024;

const SIGNATURES: { mimeType: string; test: (b: Buffer) => boolean }[] = [
  { mimeType: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** Reads a "data:image/...;base64,..." picture; null when it isn't a real JPEG/PNG/WebP or is too big. */
export function readCoverDataUrl(dataUrl: string): { mimeType: string; data: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const data = Buffer.from(match[2], 'base64');
  if (data.length === 0 || data.length > MAX_COVER_BYTES) return null;
  const kind = SIGNATURES.find((s) => s.test(data));
  if (!kind || kind.mimeType !== match[1]) return null;
  return { mimeType: kind.mimeType, data };
}

export function newCoverVersion(): string {
  return crypto.randomBytes(6).toString('hex');
}

/** The link phones use for a cover; changes with every new cover so caches refresh. */
export function coverUrl(book: { id: string; coverVersion: string | null }, base = '/api/member/library/books'): string | null {
  return book.coverVersion ? `${base}/${book.id}/cover?v=${book.coverVersion}` : null;
}

/** The link for the French cover (null when the book has none: French readers then get the English one). */
export function coverFrUrl(book: { id: string; coverFrVersion: string | null }, base = '/api/member/library/books'): string | null {
  return book.coverFrVersion ? `${base}/${book.id}/cover?lang=fr&v=${book.coverFrVersion}` : null;
}

/** Sends a book's cover picture (404 when it has none). `lang=fr` sends the French cover, else the English one. */
export async function sendCover(res: Response, bookId: string, versioned: boolean, lang?: unknown) {
  const select = { mimeType: true, data: true } as const;
  const cover = lang === 'fr' ? await prisma.libraryBookCoverFr.findUnique({ where: { bookId }, select }) : await prisma.libraryBookCover.findUnique({ where: { bookId }, select });
  if (!cover) return res.status(404).json({ error: 'No cover.' });
  res.setHeader('Content-Type', cover.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // A versioned link never changes content, so phones may keep it (and
  // show it offline); an unversioned one is checked each time.
  res.setHeader('Cache-Control', versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache');
  res.send(Buffer.from(cover.data));
}
