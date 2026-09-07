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

const CACHE_VERSION = 'god-nation-v1';

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
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (
            (await cache.match(request)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/'))
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
