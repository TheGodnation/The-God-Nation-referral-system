// A book's pages are made smaller for reading on a phone: about four of those pages make one page of a normal printed book.
// Students are shown both numbers, so a big number is not discouraging.
export const MOBILE_PAGES_PER_NORMAL_PAGE = 4;

/** About how many pages of a normal printed book this many mobile-format pages make. */
export function normalPages(mobilePages: number): number {
  return Math.max(1, Math.round(mobilePages / MOBILE_PAGES_PER_NORMAL_PAGE));
}
