// Minimal PWA service worker for The God Nation Referral System.
//
// Scope is intentionally narrow and conservative:
// - Never touches /api/* requests. All auth, session, CSRF, and dashboard
//   data must always go straight to the network — caching any of that would
//   risk showing stale or wrong-user data, or masking a real auth failure.
// - Only caches same-origin GET requests for the built static app shell
//   (HTML/JS/CSS/icons), so "Add to Home Screen" gives an installable,
//   app-like experience and the last-loaded shell still opens if the
//   network is briefly unavailable (e.g. Render's free-tier cold start).
// - Bumping CACHE_VERSION on a future change invalidates old caches; old
//   versions are removed on activate so this never accumulates indefinitely.

const CACHE_VERSION = 'god-nation-v2';

// Shown only when: the network is genuinely unreachable AND nothing has
// been cached yet (e.g. the very first launch from a freshly-added home
// screen icon happens with no connectivity). Never leave respondWith()
// resolving to undefined here — that produces a hard, blank failure to
// open instead of a readable message.
const OFFLINE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The God Nation</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f2260; color: #fff;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
  button { margin-top: 16px; padding: 10px 20px; border-radius: 8px; border: none;
           background: #e0b027; color: #0f2260; font-weight: 600; font-size: 16px; }
</style></head>
<body>
  <div>
    <p>Could not reach The God Nation.<br>Check your connection and try again.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
</body></html>`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GETs; let everything else (POST/PATCH/DELETE,
  // cross-origin requests) pass straight through untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (loading a page/route): try the network first so users
  // always get the latest app shell when online; fall back to the last
  // cached shell if the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
          const response = await fetch(request);
          cache.put(request, response.clone());
          return response;
        } catch {
          // Network genuinely unreachable — fall back to whatever shell is
          // cached; if nothing is cached yet (e.g. this is the very first
          // launch and there's no connectivity), still return a real
          // Response so the icon never just "does nothing" when tapped.
          const cached =
            (await cache.match(request)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/'));
          return (
            cached ||
            new Response(OFFLINE_HTML, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  // Static assets (hashed JS/CSS/icons): cache-first, since Vite's build
  // output is content-hashed — a cached copy is always valid for its exact
  // URL, so this can never serve stale content for a given filename.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })(),
  );
});
