import { Router, type Request, type Response } from 'express';
import { getObjectStream } from '../storage';
import { prisma } from '../prisma';
import { DIVISIONS, LANGS, SECTION, type Lang } from './content';
import { loadPublicContext } from './articles';
import { allPagesWith, joinHref, pathOf, renderNotFound, renderPage, sitemapXml, type Ctx, type PageRef } from './render';

// The public website (/en/… and /fr/…). Mounted in app.ts BEFORE the cookie, session and API
// steps, so its pages carry no cookies (and can be cached safely), and only when the switch
// PUBLIC_SITE_ENABLED=true is on. With the switch off, none of these addresses exist and
// everything behaves exactly as before.
//
// Articles come from the database, but pages are written once and kept in memory:
//   * a visitor or crawler is served from memory, not from the database;
//   * the kept copy is refreshed in the background every minute, and at once whenever an
//     editor publishes, changes or withdraws something (invalidatePublicSite);
//   * if the database is briefly unavailable, the last good copy keeps being served;
//   * if there is no good copy yet (first request after a restart while the database is
//     asleep), visitors get a short "try again" page (503), never a false "page not found".
// Missing pages get a real 404, never the app's empty page.

const CACHE_HEADER = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const REFRESH_AFTER_MS = 60_000;

interface Snapshot {
  ctx: Ctx;
  pages: Map<string, PageRef>;
  html: Map<string, string>;
  sitemap: string;
  at: number;
}

let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;
let generation = 0;
let dirty = false;

/** An editor changed something: the next visit rebuilds the pages first (the old copy stays as a fallback). */
export function invalidatePublicSite(): void {
  generation++;
  dirty = true;
}

/** For tests only: forget everything kept. */
export function resetPublicSiteForTests(): void {
  snapshot = null; loading = null; dirty = false; generation++;
}

async function build(): Promise<Snapshot> {
  const ctx = await loadPublicContext(prisma);
  const pages = new Map<string, PageRef>();
  for (const p of allPagesWith(ctx)) pages.set(pathOf(p), p);
  return { ctx, pages, html: new Map(), sitemap: sitemapXml(ctx), at: Date.now() };
}

function refresh(): Promise<Snapshot> {
  if (loading) return loading;
  const startedAt = generation;
  loading = build()
    .then((s) => {
      snapshot = s;
      // If something changed while we were reading, the copy is already out of date.
      dirty = generation !== startedAt;
      return s;
    })
    .finally(() => { loading = null; });
  return loading;
}

async function current(): Promise<Snapshot | null> {
  if (snapshot && !dirty && Date.now() - snapshot.at < REFRESH_AFTER_MS) return snapshot;
  if (snapshot && dirty) {
    // A person just changed something: wait for the new copy, but fall back to the old one if the database is away.
    try { return await refresh(); } catch { return snapshot; }
  }
  if (snapshot) {
    // Only old by the clock: serve what we have; fetch the new copy in the background.
    refresh().catch(() => undefined);
    return snapshot;
  }
  try {
    return await refresh();
  } catch {
    return null;
  }
}

function send(res: Response, lang: Lang, html: string, status = 200) {
  res.status(status).set('Content-Language', lang).set('Cache-Control', status === 200 ? CACHE_HEADER : 'no-store').type('html').send(html);
}

function unavailable(res: Response, lang: Lang) {
  const text = lang === 'fr' ? 'Cette page est momentanément indisponible. Veuillez réessayer dans une minute.' : 'This page is briefly unavailable. Please try again in a minute.';
  res.status(503).set('Retry-After', '30').set('Cache-Control', 'no-store').set('Content-Language', lang).type('html')
    .send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>The God Nation</title></head><body style="font-family:system-ui,sans-serif;max-width:34em;margin:12vh auto;padding:0 20px"><h1>The God Nation</h1><p>${text}</p></body></html>`);
}

export function publicSiteRouter(): Router {
  const router = Router();

  // Pictures uploaded for the Knowledge Centre. Only rows registered as Knowledge Centre media are
  // ever served (never an arbitrary storage key), with a long cache because a picture's address
  // never changes: a replaced picture is a new one.
  router.get(/^\/media\/k\/([0-9a-f-]{36})\.(jpg|png|webp)$/, async (req: Request, res: Response) => {
    try {
      const [, id, ext] = req.path.match(/^\/media\/k\/([0-9a-f-]{36})\.(jpg|png|webp)$/)!;
      const row = await prisma.knowledgeMedia.findUnique({ where: { id }, select: { storageKey: true, mimeType: true } });
      const wanted = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext];
      if (!row || row.mimeType !== wanted) return res.status(404).type('text/plain').send('Not found.');
      const obj = await getObjectStream({ storageKey: row.storageKey });
      if (!obj) return res.status(404).type('text/plain').send('Not found.');
      res.set({ 'Content-Type': row.mimeType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      if (obj.contentLength !== undefined) res.set('Content-Length', String(obj.contentLength));
      obj.body.on('error', () => res.destroy());
      obj.body.pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).type('text/plain').set('Cache-Control', 'no-store').send('Temporarily unavailable.');
    }
  });

  // Friendly addresses that lead to the existing, only registration and sign-in systems.
  for (const lang of LANGS) {
    const s = SECTION[lang];
    router.get(`/${lang}/${s.join}/`, (_req, res) => res.redirect(302, joinHref(lang, 'join-page')));
    router.get(`/${lang}/${s.login}/`, (_req, res) => res.redirect(302, '/member/login'));
  }

  // One address per page, with a trailing slash; the same address without it moves there.
  router.use((req, res, next) => {
    const m = /^\/(en|fr)(\/.*)?$/.exec(req.path);
    if (!m) return next();
    if (!req.path.endsWith('/') && !/\.[a-z0-9]+$/i.test(req.path)) {
      const q = req.originalUrl.indexOf('?');
      return res.redirect(301, req.path + '/' + (q >= 0 ? req.originalUrl.slice(q) : ''));
    }
    next();
  });

  router.get('/sitemap-public.xml', async (_req, res) => {
    const s = await current();
    if (!s) return res.status(503).set('Retry-After', '30').set('Cache-Control', 'no-store').type('text/plain').send('Temporarily unavailable.');
    res.set('Cache-Control', CACHE_HEADER).type('application/xml').send(s.sitemap);
  });

  router.get(/^\/(en|fr)\/.*$/, async (req: Request, res: Response) => {
    const lang: Lang = req.path.startsWith('/fr/') ? 'fr' : 'en';
    const s = await current();
    if (!s) return unavailable(res, lang);
    const p = s.pages.get(req.path);
    if (!p) return send(res, lang, renderNotFound(lang), 404);
    let html = s.html.get(req.path);
    if (!html) { html = renderPage(p, s.ctx); s.html.set(req.path, html); }
    send(res, lang, html);
  });

  return router;
}

// Referenced so a typo in a division key cannot silently break the join tags.
export const DIVISION_KEYS = DIVISIONS.map((d) => d.key);
