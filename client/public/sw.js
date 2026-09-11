// Minimal PWA service worker for The God Nation Referral System.
//
// v3: deliberately does as little as possible. An earlier version tried to
// intercept and handle navigation (page-load) requests itself — offline
// fallback, cached-shell fallback, etc. On at least one real Android/Chrome
// device that caused the installed app to flash open and immediately close
// instead of loading — almost certainly a rejected/invalid response from
// that custom navigation-handling path crashing the standalone launch.
//
// So now: navigations are never intercepted at all. They go straight to the
// network exactly like a normal browser tab (the one thing we know already
// works reliably), and this service worker's only job is to cache-first the
// build's hashed static assets (JS/CSS/icons) — content-addressed by Vite,
// so a cached copy can never be stale for a given URL. Every branch below is
// wrapped so this can never throw or resolve to something invalid; the
// worst case on any failure is simply falling through to a normal network
// fetch, i.e. behaving as if there were no service worker at all.
//
// /api/* is still never touched — auth, session, CSRF, and dashboard data
// must always go straight to the network.

const CACHE_VERSION = 'god-nation-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
        );
      } catch {
        // Non-fatal — worst case an old cache lingers until it's cleaned up
        // on a future activate.
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') return; // never intercept page loads

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          try {
            await cache.put(request, response.clone());
          } catch {
            // Some responses (opaque, partial, etc.) can't be cached —
            // that's fine, just skip caching this one.
          }
        }
        return response;
      } catch {
        // Cache API unavailable, or the network fetch itself failed — fall
        // back to a plain network fetch so this asset request behaves
        // exactly as if the service worker weren't here at all.
        return fetch(request);
      }
    })(),
  );
});
