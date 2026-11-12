// A saved copy of what the app last read from the server, so any screen can open without internet
// (WhatsApp style: you see what you saw last). Kept per member in the browser's own database
// (IndexedDB), removed on sign-out. Only reads (GET) of a signed-in member are kept; chats, files,
// sign-in, one-time links and search have their own handling or must always be live.
// Best effort: when the browser cannot store it, everything works online as before.

const DB_NAME = 'godnation-reads';
const STORE = 'reads';
export const READ_ENTRY_MAX_CHARS = 400_000; // one answer bigger than this is not kept
export const READ_ENTRIES_MAX = 300; // per member; the oldest go first

interface Entry {
  key: string;
  ownerId: string;
  path: string;
  json: string;
  savedAt: number;
}

let owner: string | null = null;
/** Who the member on this phone is (set when they are known, cleared on sign-out). */
export function setReadCacheOwner(personId: string | null) {
  owner = personId;
}
export const readCacheOwner = () => owner;

/** What must never be kept or served from a saved copy: sign-in and sessions, live data, signed links, files, searches. */
const SKIP = [/^\/api\/admin\//, /^\/api\/member\/central/, /^\/api\/(member\/)?auth\//, /^\/api\/health/, /\/messages(\?|$|\/)/, /download-url/, /\/attachments/, /\/search/, /\/typing/, /\/ping/, /\/csrf/];
export const isKeepable = (path: string) => path.startsWith('/api/') && !SKIP.some((re) => re.test(path));

let opening: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('ownerId', 'ownerId');
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
  return opening;
}

const keyOf = (ownerId: string, lang: string, path: string) => `${ownerId}|${lang}|${path}`;

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function keepRead(path: string, lang: string, data: unknown): Promise<void> {
  const ownerId = owner;
  if (!ownerId || !isKeepable(path)) return;
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return;
  }
  if (!json || json.length > READ_ENTRY_MAX_CHARS) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key: keyOf(ownerId, lang, path), ownerId, path, json, savedAt: Date.now() } satisfies Entry);
    await done(tx);
    void trim(db, ownerId);
  } catch {
    // Not kept: fine.
  }
}

/** Lets the oldest copies go when a member has more than READ_ENTRIES_MAX. */
async function trim(db: IDBDatabase, ownerId: string): Promise<void> {
  try {
    const all = await new Promise<Entry[]>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).index('ownerId').getAll(ownerId);
      req.onsuccess = () => resolve(req.result as Entry[]);
      req.onerror = () => resolve([]);
    });
    if (all.length <= READ_ENTRIES_MAX) return;
    const extra = all.sort((a, b) => a.savedAt - b.savedAt).slice(0, all.length - READ_ENTRIES_MAX);
    const tx = db.transaction(STORE, 'readwrite');
    for (const e of extra) tx.objectStore(STORE).delete(e.key);
    await done(tx);
  } catch {
    // Ignore.
  }
}

/** The last answer kept for this read, or null. */
export async function savedRead<T>(path: string, lang: string): Promise<T | null> {
  const ownerId = owner;
  if (!ownerId || !isKeepable(path)) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const entry = await new Promise<Entry | undefined>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(keyOf(ownerId, lang, path));
      req.onsuccess = () => resolve(req.result as Entry | undefined);
      req.onerror = () => resolve(undefined);
    });
    return entry ? (JSON.parse(entry.json) as T) : null;
  } catch {
    return null;
  }
}

/** How many saved screens this member has (for the "Ready for offline?" check). */
export async function savedReadCount(ownerId: string): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  try {
    return await new Promise<number>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).index('ownerId').count(ownerId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/** Removes everything kept for this member (sign-out, account deletion). */
export async function clearReadCache(ownerId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).index('ownerId').getAllKeys(ownerId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
    const tx = db.transaction(STORE, 'readwrite');
    for (const k of keys) tx.objectStore(STORE).delete(k);
    await done(tx);
  } catch {
    // Ignore.
  }
}
