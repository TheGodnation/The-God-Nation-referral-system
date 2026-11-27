// Older messages open by themselves as the member scrolls up a chat (no "Load older messages" tap needed, and no limit: page after
// page keeps coming while there is more). A page is asked for when the view comes within this distance of the top.
export const AUTO_OLDER_PX = 400;
/** After a failed automatic load, wait this long before trying again by itself (the button stays there to try at once). */
export const AUTO_OLDER_RETRY_MS = 10000;

/** Whether the view is close enough to the top to bring in the next older page. */
export function nearTop(el: HTMLElement): boolean {
  return el.scrollTop < AUTO_OLDER_PX;
}

/** Whether the messages do not even fill the screen, so the member cannot scroll up to ask for more. */
export function notFilled(el: HTMLElement): boolean {
  return el.scrollHeight <= el.clientHeight + 4;
}
