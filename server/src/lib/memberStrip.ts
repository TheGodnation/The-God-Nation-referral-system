// The Home page strip of member photos revolves: the people who have a photo
// are kept in one stable order, and every hour the strip moves on to the
// next few, wrapping round at the end, so the same faces are not there for
// long and everyone with a photo gets their turn. People without a photo come
// after (see routes/social.ts).
export const STRIP_SIZE = 40;
export const STRIP_WINDOW_MS = 60 * 60 * 1000;

/** Which one-hour window `now` (milliseconds) falls in. */
export function stripWindow(now: number): number {
  return Math.floor(now / STRIP_WINDOW_MS);
}

/**
 * Where in the stable list of people with photos this window starts.
 * More people than places: move on by a full strip each window.
 * Fewer than places: everyone is shown, and the order turns by one each window.
 */
export function stripStart(count: number, size: number, window: number): number {
  if (count <= 0) return 0;
  return count > size ? (window * size) % count : window % count;
}
