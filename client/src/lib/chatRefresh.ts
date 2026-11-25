/**
 * After a message is posted, the chat asks the server for what is new so the message shows in the list. On a slow connection that
 * second request can fail while the post itself went through, and the message then seems to vanish (its "sending" bubble is gone
 * and the real one is not there yet). So the request is repeated a few times, a little later each time, until it works. A request
 * that works but finds nothing new (the regular refresh already brought the message) ends it at once.
 */
export async function refreshAfterSend(refresh: () => Promise<unknown>, failed: () => boolean, waitsMs: number[] = [1500, 3000, 5000]): Promise<void> {
  await refresh();
  for (const wait of waitsMs) {
    if (!failed()) return;
    await new Promise((resolve) => window.setTimeout(resolve, wait));
    await refresh();
  }
}
