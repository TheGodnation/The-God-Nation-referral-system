// The database host (Neon) bills compute only while it is awake and puts the
// database to sleep after a few minutes with no queries. The background
// checks below used to query once a minute around the clock, which kept it
// awake all night. They now run every minute only while people are using the
// app (and for a while after), and rarely when nobody is.
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
export const ACTIVE_TICK_MS = 60 * 1000;
export const IDLE_TICK_MS = 30 * 60 * 1000;

let lastActivityAt = Date.now();

/** Called for every real API request (not the host's health check). */
export function markActivity(now = Date.now()): void {
  lastActivityAt = now;
}

export function nextTickDelayMs(now = Date.now()): number {
  return now - lastActivityAt <= ACTIVE_WINDOW_MS
    ? ACTIVE_TICK_MS
    : IDLE_TICK_MS;
}

/**
 * Runs `tick` for the life of the process, never overlapping itself and never
 * throwing, once a minute while the app is in use and every 30 minutes when
 * it is not. The first run happens soon after start so a restart catches up.
 */
export function startAdaptiveLoop(
  tick: () => Promise<unknown>,
  onError: (err: unknown) => void,
): void {
  const schedule = (delay: number) => {
    const timer = setTimeout(() => {
      tick()
        .catch(onError)
        .finally(() => schedule(nextTickDelayMs()));
    }, delay);
    timer.unref();
  };
  schedule(ACTIVE_TICK_MS);
}
