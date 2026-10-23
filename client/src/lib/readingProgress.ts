import { api } from './api';

// The reader's bookmark: the page someone is on, kept on the phone at once
// (so it works offline) and sent to the server now and then, so the book
// opens at the same page on any phone. A save made offline is sent the
// next time the book is opened with internet.

export interface Bookmark {
  page: number;
  at: string;
  synced: boolean;
}

const keyOf = (ownerId: string, bookId: string) => `reading:${ownerId}:${bookId}`;

export function readLocalBookmark(ownerId: string, bookId: string): Bookmark | null {
  try {
    const raw = localStorage.getItem(keyOf(ownerId, bookId));
    const b = raw ? JSON.parse(raw) : null;
    return b && Number.isInteger(b.page) && b.page >= 1 && typeof b.at === 'string' ? b : null;
  } catch {
    return null;
  }
}

export function writeLocalBookmark(ownerId: string, bookId: string, bookmark: Bookmark) {
  try {
    localStorage.setItem(keyOf(ownerId, bookId), JSON.stringify(bookmark));
  } catch {
    // Storage full or blocked: the server copy still works when online.
  }
}

/** The newer of the phone's bookmark and the server's. */
export function newestBookmark(local: Bookmark | null, server: { page: number; at: string } | null): { page: number; at: string; fromPhone: boolean } | null {
  if (local && (!server || Date.parse(local.at) >= Date.parse(server.at))) return { page: local.page, at: local.at, fromPhone: true };
  return server ? { ...server, fromPhone: false } : null;
}

/** Sends the phone's bookmark to the server; marks it sent when it arrives. */
export async function syncBookmark(ownerId: string, bookId: string, pageCount?: number, closing = false): Promise<void> {
  const b = readLocalBookmark(ownerId, bookId);
  if (!b || b.synced) return;
  try {
    await api.put(`/api/member/library/books/${bookId}/progress`, { page: b.page, at: b.at, ...(pageCount ? { pageCount } : {}) }, { keepalive: closing });
    const now = readLocalBookmark(ownerId, bookId);
    // Only mark it sent if the reader hasn't moved on meanwhile.
    if (now && now.at === b.at) writeLocalBookmark(ownerId, bookId, { ...now, synced: true });
  } catch {
    // Offline or refused: tried again later.
  }
}
