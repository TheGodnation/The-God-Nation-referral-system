// Minimal PWA service worker for The God Nation Referral System.
//
// v4: opening the app WITHOUT INTERNET, so downloaded leadership books and
// chat documents can be read offline. Page loads still go to the network
// first, exactly as before, and the network's answer is what the phone
// gets whenever there is one. Only when the network fetch itself fails (no
// internet at all) does the app's own start page come from this phone's
// copy — a copy saved from an earlier normal visit, rebuilt as a plain
// 200 text/html response (never a redirected or opaque one, the kind
// that crashed the installed app in v2). No copy yet → the browser's usual
// offline page, same as before. PDF.js (the book reader's PDF engine,
// loaded from cdnjs at a fixed version) is also kept, so books can be drawn
// offline.
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
//
// /leader-guide/* is also excluded from cache-first. Unlike the app's own
// build assets, the guide's images and page keep the same filename across
// edits (they're not content-hashed by Vite) — so cache-first here would
// mean a leader's phone could get stuck showing an old screenshot or an old
// version of the text forever, even after we publish an update. Letting
// these go straight to the network (with normal browser HTTP caching, which
// still revalidates) keeps the guide showing what's actually live.

// Static guide pages (not part of the app): always straight from the network.
const GUIDE_PREFIXES = ['/leader-guide/', '/notifications-guide/', '/phone-settings-guide/', '/no-app-guide/'];
const isGuidePath = (p) => GUIDE_PREFIXES.some((g) => p.startsWith(g));

const CACHE_VERSION = 'god-nation-v6';
// The app's start page for offline launches, kept apart from the asset
// cache (and never deleted by a cache-version bump of the assets).
const SHELL_CACHE = 'god-nation-shell-v1';
const SHELL_KEY = '/__offline-shell';
const PDFJS_PREFIX = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_VERSION && key !== SHELL_CACHE && key !== SHARE_CACHE).map((key) => caches.delete(key)),
        );
      } catch {
        // Non-fatal — worst case an old cache lingers until it's cleaned up
        // on a future activate.
      }
      await self.clients.claim();
    })(),
  );
});

// Share-into-app (v5): when something is shared to this app from the
// phone's Share menu (WhatsApp, TikTok, Facebook, Instagram…), the phone
// POSTs it to /share-target. We keep the shared text and files on this
// phone for a moment, then open the Share screen (/share), which reads them
// and lets an allowed leader post them. Nothing is uploaded until they tap
// Post. If anything here fails, the Share screen still opens.
const SHARE_CACHE = 'god-nation-share-v1';
const SHARE_META_KEY = '/__share/meta';
const SHARE_FILE_PREFIX = '/__share/file/';

async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    // Clear anything left from an earlier share.
    const old = await cache.keys();
    await Promise.all(old.map((k) => cache.delete(k)));

    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && 'size' in f);
    const fileInfo = [];
    for (let i = 0; i < files.length && i < 10; i += 1) {
      const f = files[i];
      const key = `${SHARE_FILE_PREFIX}${i}`;
      await cache.put(
        key,
        new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'Content-Length': String(f.size) } }),
      );
      fileInfo.push({ key, name: f.name || `file-${i + 1}`, type: f.type || '', size: f.size });
    }
    const meta = {
      title: String(form.get('title') || ''),
      text: String(form.get('text') || ''),
      url: String(form.get('url') || ''),
      files: fileInfo,
      at: Date.now(),
    };
    await cache.put(SHARE_META_KEY, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    return Response.redirect('/share', 303);
  } catch {
    return Response.redirect('/share?missed=1', 303);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method === 'POST') {
    try {
      const u = new URL(request.url);
      if (u.origin === self.location.origin && u.pathname === '/share-target') {
        event.respondWith(handleShareTarget(request));
      }
    } catch {
      // Not ours — let it go to the network as normal.
    }
    return;
  }

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (request.mode === 'navigate') {
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || isGuidePath(url.pathname)) return;
    event.respondWith(networkFirstPage(request));
    return;
  }

  // PDF.js from cdnjs: a fixed version, so a kept copy never goes stale.
  if (request.url.startsWith(PDFJS_PREFIX)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (isGuidePath(url.pathname)) return;

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

// Page loads: the network's answer whenever there is one (and a clean copy
// of a good start page is kept); this phone's copy only when the network
// can't be reached at all.
async function networkFirstPage(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (networkError) {
    try {
      const cache = await caches.open(SHELL_CACHE);
      const shell = await cache.match(SHELL_KEY);
      if (shell) return shell;
    } catch {
      // No cache available — behave as if there were no service worker.
    }
    throw networkError;
  }
  try {
    const type = response.headers.get('content-type') || '';
    if (response.ok && response.status === 200 && !response.redirected && response.type === 'basic' && type.includes('text/html')) {
      const body = await response.clone().text();
      const copy = new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(SHELL_KEY, copy);
    }
  } catch {
    // Keeping the copy is optional; the page itself is unaffected.
  }
  return response;
}

async function cacheFirst(request) {
  try {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      try {
        await cache.put(request, response.clone());
      } catch {
        // Not cacheable — fine.
      }
    }
    return response;
  } catch {
    return fetch(request);
  }
}

// Phase 5 — Web Push: background/closed-app notification delivery. Kept to
// the same "never throw, degrade gracefully" discipline as the rest of this
// file — a malformed or missing payload shows nothing rather than crashing
// the worker, and notificationclick falls back to opening a fresh window if
// focusing an existing one isn't possible.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON or empty payload — nothing to show.
  }
  const title = data.title || 'The God Nation';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options).catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      try {
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const existing of clientsList) {
          if ('focus' in existing) {
            if ('navigate' in existing) {
              try {
                await existing.navigate(url);
              } catch {
                // Navigation isn't always permitted (cross-origin, etc.) —
                // focusing the existing tab as-is is still better than nothing.
              }
            }
            return existing.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      } catch {
        // Nothing more we can do — the click is still consumed either way.
      }
    })(),
  );
});
