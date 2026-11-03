import { Router, type Request, type Response } from 'express';
import { DIVISIONS, LANGS, SECTION, type Lang } from './content';
import { allPages, pathOf, renderNotFound, renderPage, sitemapXml, joinHref, type PageRef } from './render';

// The public website (/en/… and /fr/…). Mounted in app.ts BEFORE the cookie, session and API
// steps, so its pages carry no cookies (and can be cached safely), and only when the switch
// PUBLIC_SITE_ENABLED=true is on. With the switch off, none of these addresses exist and
// everything behaves exactly as before.
//
// Pages are written once and kept (they have no database content in Phase 2). Missing pages
// get a real 404, never the app's empty page.

const CACHE_HEADER = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const kept = new Map<string, string>();

function send(res: Response, lang: Lang, html: string, status = 200) {
  res.status(status).set('Content-Language', lang).set('Cache-Control', status === 200 ? CACHE_HEADER : 'no-store').type('html').send(html);
}

export function publicSiteRouter(): Router {
  const router = Router();

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

  const pages = new Map<string, PageRef>();
  for (const p of allPages()) pages.set(pathOf(p), p);

  router.get('/sitemap-public.xml', (_req, res) => {
    res.set('Cache-Control', CACHE_HEADER).type('application/xml').send(sitemapXml());
  });

  router.get(/^\/(en|fr)\/.*$/, (req: Request, res: Response) => {
    const lang = req.path.startsWith('/fr/') ? 'fr' : 'en';
    const p = pages.get(req.path);
    if (!p) return send(res, lang, renderNotFound(lang), 404);
    let html = kept.get(req.path);
    if (!html) { html = renderPage(p); kept.set(req.path, html); }
    send(res, lang, html);
  });

  return router;
}

// Referenced so a typo in a division key cannot silently break the join tags.
export const DIVISION_KEYS = DIVISIONS.map((d) => d.key);
