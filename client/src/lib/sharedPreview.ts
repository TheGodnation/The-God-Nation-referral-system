// The shared-link page (a post opened from WhatsApp): a visitor who is not a member reads the beginning, then is invited to join
// to read the rest. Members read everything. After joining (or signing in) the visitor is brought back to the same post.

/** Posts shorter than this are shown whole: cutting a few lines would only annoy. */
export const SHOW_WHOLE_BELOW = 400;
/** How much of the writing a visitor reads before being invited to join. */
export const PREVIEW_SHARE = 1 / 2;
/** Never fewer paragraphs than this (when the post has more). */
export const MIN_PARAGRAPHS = 2;

/** The beginning of a post for a visitor, and whether anything was held back. */
export function previewOf(text: string): { shown: string; cut: boolean } {
  const clean = text.trim();
  if (clean.length < SHOW_WHOLE_BELOW) return { shown: clean, cut: false };
  const target = clean.length * PREVIEW_SHARE;
  const paragraphs = clean.split(/\n\s*\n/);
  if (paragraphs.length > MIN_PARAGRAPHS) {
    const kept: string[] = [];
    let length = 0;
    for (const p of paragraphs) {
      if (kept.length >= MIN_PARAGRAPHS && length >= target) break;
      kept.push(p);
      length += p.length;
    }
    if (kept.length < paragraphs.length) return { shown: kept.join('\n\n'), cut: true };
    return { shown: clean, cut: false };
  }
  // Few, long paragraphs: stop at the end of a sentence near half way.
  const after = clean.slice(Math.floor(target));
  const end = after.search(/[.!?…](\s|$)/);
  if (end < 0) return { shown: clean, cut: false };
  const cutAt = Math.floor(target) + end + 1;
  if (cutAt >= clean.length - 20) return { shown: clean, cut: false };
  return { shown: clean.slice(0, cutAt).trim(), cut: true };
}

const KEY = 'godnation:afterJoin';
/** The way back is only kept for a day: someone who joins much later starts in the community as usual. */
const KEEP_MS = 24 * 60 * 60 * 1000;
const SAFE_PATH = /^\/news\/(post|announcement|update)\/[A-Za-z0-9-]+$/;

/** Remembers the post, so that after joining or signing in the visitor comes back to read all of it. */
export function rememberPostToReturnTo(path: string): void {
  if (!SAFE_PATH.test(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* not remembered: they arrive in the community as usual */
  }
}

/** The remembered post, if there is a fresh one (it is forgotten as it is taken). */
export function takePostToReturnTo(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.path !== 'string' || !SAFE_PATH.test(v.path) || typeof v.at !== 'number' || now - v.at > KEEP_MS) return null;
    return v.path;
  } catch {
    return null;
  }
}
