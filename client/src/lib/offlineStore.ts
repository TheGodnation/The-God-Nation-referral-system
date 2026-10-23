// Books and documents downloaded on this phone, WhatsApp style: a leadership
// book is kept after it is first opened, and a PDF from a chat after it is
// first viewed, so both open again without internet. Kept in the browser's
// own database (IndexedDB), per member: someone else signing in on the same
// phone never sees them, and signing out removes them. Best effort — when
// the browser has no IndexedDB (or a private window refuses it) everything
// still works online, it just isn't kept.

import { NetworkError } from './api';

export type SavedKind = 'BOOK' | 'DOC';

export interface SavedInfo {
  key: string;
  ownerId: string;
  kind: SavedKind;
  title: string;
  byteSize: number;
  savedAt: number;
  /** BOOK: the PDF version it was downloaded from (a new upload replaces it). */
  version?: string;
  /** What is needed to show it without the server (book: reader info; doc: chat link). */
  meta?: Record<string, unknown>;
}

export interface SavedFile extends SavedInfo {
  blob: Blob;
}

const DB_NAME = 'godnation-offline';
const FILES = 'files';
const INFO = 'info';

let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  const p = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        // The file itself and its description are kept apart, so listing
        // what is saved never loads the files.
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
        if (!db.objectStoreNames.contains(INFO)) db.createObjectStore(INFO, { keyPath: 'key' }).createIndex('ownerId', 'ownerId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    if (!db) opening = null;
    return db;
  });
  opening = p;
  return p;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

function read<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export const bookKey = (ownerId: string, bookId: string) => `${ownerId}:book:${bookId}`;
export const docKey = (ownerId: string, attachmentId: string) => `${ownerId}:doc:${attachmentId}`;

/** A Blob's bytes (older browsers have no Blob.arrayBuffer). */
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Keeps a file on this phone (replacing an older copy). False when it couldn't be kept (no room, no IndexedDB). */
export async function saveFile(info: Omit<SavedInfo, 'savedAt' | 'byteSize'> & { blob: Blob }): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const { blob, ...rest } = info;
    // Kept as plain bytes: every browser can store those.
    const bytes = await blobBytes(blob);
    const tx = db.transaction([FILES, INFO], 'readwrite');
    tx.objectStore(FILES).put(bytes, info.key);
    tx.objectStore(INFO).put({ ...rest, byteSize: bytes.byteLength, savedAt: Date.now() });
    const ok = await done(tx);
    if (ok) {
      askToKeepStorage();
      window.dispatchEvent(new Event('offline-files-changed'));
    }
    return ok;
  } catch {
    return false;
  }
}

export async function getInfo(key: string): Promise<SavedInfo | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return ((await read(db.transaction(INFO).objectStore(INFO).get(key))) as SavedInfo | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function getFile(key: string): Promise<SavedFile | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction([FILES, INFO]);
    const [info, bytes] = await Promise.all([read(tx.objectStore(INFO).get(key)), read(tx.objectStore(FILES).get(key))]);
    return info && bytes ? { ...(info as SavedInfo), blob: new Blob([bytes as ArrayBuffer], { type: 'application/pdf' }) } : null;
  } catch {
    return null;
  }
}

/** Everything this member has kept on this phone, newest first. */
export async function listSaved(ownerId: string): Promise<SavedInfo[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const rows = ((await read(db.transaction(INFO).objectStore(INFO).index('ownerId').getAll(ownerId))) ?? []) as SavedInfo[];
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Refreshes what is kept about a saved file (not the file itself). */
export async function updateMeta(key: string, meta: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const info = (await read(db.transaction(INFO).objectStore(INFO).get(key))) as SavedInfo | undefined;
    if (!info) return;
    const tx = db.transaction(INFO, 'readwrite');
    tx.objectStore(INFO).put({ ...info, meta });
    await done(tx);
  } catch {
    // Keeps the older details; the book still opens.
  }
}

export async function deleteSaved(keys: string[]): Promise<void> {
  const db = await openDb();
  if (!db || keys.length === 0) return;
  try {
    const tx = db.transaction([FILES, INFO], 'readwrite');
    for (const key of keys) {
      tx.objectStore(FILES).delete(key);
      tx.objectStore(INFO).delete(key);
    }
    await done(tx);
    window.dispatchEvent(new Event('offline-files-changed'));
  } catch {
    // Nothing more to do; the copy simply stays.
  }
}

/** Removes everything a member kept on this phone (when they sign out). */
export async function deleteAllFor(ownerId: string): Promise<void> {
  await deleteSaved((await listSaved(ownerId)).map((s) => s.key));
}

/** Asks the browser not to clear downloaded books when the phone runs low on space. */
function askToKeepStorage() {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // Not supported: the browser decides.
  }
}

/** How much this site keeps on the phone, and roughly how much room is left. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && typeof e.usage === 'number' && typeof e.quota === 'number' ? { usage: e.usage, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** True when a failure means "no internet / server unreachable" rather than a real answer from the server. */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  const status = (err as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 502 && status <= 504;
}
