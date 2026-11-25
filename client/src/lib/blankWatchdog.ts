import { reportClientError } from './reportError';

// A page that stays white (or on "Loading…") for many seconds is never useful to anyone. When that happens we
//  1. tell the server what the phone was doing (so the real cause can be found), and
//  2. show a plain "Reload" button. (There used to be a "Fix and reload" button that removed the app's background part: that also cut
//     the phone's notifications, so it is gone. The page's own rescue in index.html clears an old saved copy without touching them.)
// Plain DOM on purpose: it must work even when the app itself is what failed.

const CHECK_EVERY_MS = 3000;
const BLANK_CHECKS = 3; // about 9 seconds in a row
const OVERLAY_ID = 'blank-page-help';

export function isBlank(root: HTMLElement | null): boolean {
  if (!root) return true;
  if (root.querySelector('[data-route-loading]')) return true;
  return (root.innerText || '').trim().length === 0;
}

function showHelp(): void {
  if (document.getElementById(OVERLAY_ID)) return;
  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:12px;padding:14px;font-family:system-ui,sans-serif;font-size:14px;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.18)';
  const text = document.createElement('p');
  text.style.cssText = 'margin:0 0 10px';
  text.textContent = 'This page is taking too long. / Cette page met trop de temps.';
  const mk = (label: string, onClick: () => void, primary: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `margin:4px;padding:9px 16px;border-radius:8px;font-weight:600;border:1px solid #0f2260;${primary ? 'background:#0f2260;color:#fff' : 'background:#fff;color:#0f2260'}`;
    b.onclick = onClick;
    return b;
  };
  box.append(
    text,
    mk('Reload / Recharger', () => window.location.reload(), true),
  );
  document.body.appendChild(box);
}

function hideHelp(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

export function startBlankWatchdog(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let blankRuns = 0;
  let reported = false;
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    const root = document.getElementById('root');
    if (!isBlank(root)) {
      blankRuns = 0;
      hideHelp();
      return;
    }
    blankRuns += 1;
    if (blankRuns < BLANK_CHECKS) return;
    showHelp();
    if (!reported) {
      reported = true;
      const loading = !!root?.querySelector('[data-route-loading]');
      reportClientError('script', new Error(`blank-page: ${loading ? 'stuck on Loading' : 'nothing on screen'}; sw=${navigator.serviceWorker?.controller ? 'on' : 'off'}`));
    }
  }, CHECK_EVERY_MS);
}
