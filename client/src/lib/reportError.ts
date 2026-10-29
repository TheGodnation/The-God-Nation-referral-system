// When a screen crashes, tell the server (it only logs it) so the real cause
// can be seen and fixed. Best-effort and quiet: never throws, never loops,
// and at most a few reports per page load.

let sent = 0;
const MAX_REPORTS = 3;

/** Errors that mean "the app files changed under this open page" — fixed by loading the page again. */
export function isStaleAppError(error: unknown): boolean {
  const msg = String((error as { message?: string } | null)?.message ?? error ?? '');
  return /dynamically imported module|importing a module script failed|loading chunk|loading css chunk|unexpected token '<'|is not a valid javascript mime type/i.test(msg);
}

/** Loads the page again once (a second time within a minute would only loop). */
export function reloadOnceForNewVersion(): boolean {
  try {
    const key = 'app-reloaded-at';
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: still reload this once.
  }
  window.location.reload();
  return true;
}

export function reportClientError(kind: 'render' | 'script' | 'chunk', error: unknown, componentStack?: string | null) {
  try {
    if (sent >= MAX_REPORTS) return;
    sent += 1;
    const e = error as { message?: string; stack?: string } | null;
    const standalone =
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        kind,
        message: String(e?.message ?? error ?? 'unknown'),
        stack: e?.stack,
        componentStack: componentStack ?? undefined,
        path: window.location.pathname,
        userAgent: navigator.userAgent,
        language: navigator.language,
        standalone,
      }),
    }).catch(() => undefined);
  } catch {
    // Reporting must never cause another error.
  }
}
