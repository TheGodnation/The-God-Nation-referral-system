// Unsent text kept on this phone, like WhatsApp: leave a chat, come back, and
// what you were typing is still there. One draft per box (per chat), kept for
// 30 days, removed when the message is sent, and erased when the member signs
// out so a shared phone never shows someone else's words. Drafts stay on the
// phone; they do not follow you to another one.

const PREFIX = 'draft:v1:';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** The storage key for one person's draft in one place, e.g. group:<id>. */
export const draftKeyFor = (personId: string | undefined, place: string) => `${personId ?? 'me'}:${place}`;

interface Stored {
  text: string;
  at: number;
}

function read(key: string): Stored | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored;
    if (typeof d.text !== 'string' || typeof d.at !== 'number') return null;
    if (Date.now() - d.at > KEEP_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/** The saved draft, or an empty string. */
export function loadDraft(key: string | undefined): string {
  return key ? (read(key)?.text ?? '') : '';
}

/** Saves the draft; an empty box removes it. */
export function saveDraft(key: string | undefined, text: string): void {
  if (!key) return;
  try {
    if (text.trim()) localStorage.setItem(PREFIX + key, JSON.stringify({ text, at: Date.now() } satisfies Stored));
    else localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage full or unavailable: the draft is simply not kept.
  }
}

export function clearDraft(key: string | undefined): void {
  if (!key) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to do.
  }
}

/** Removes every draft on this phone (when a member signs out). */
export function clearAllDrafts(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // Nothing to do.
  }
}

/** Removes drafts older than 30 days. */
export function pruneDrafts(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) read(k.slice(PREFIX.length));
  } catch {
    // Nothing to do.
  }
}
