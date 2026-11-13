// Link previews. When a link is shared in WhatsApp, Facebook, Telegram or
// X, those apps read the page's title, picture and sentence from the first
// HTML they get, without running any scripts. The app's pages are built in
// the browser, so every shared link used to show the same blank card. Here the
// right tags are written into the page before it is sent.

import type { NextFunction, Request, Response } from 'express';

type Lang = 'en' | 'fr';

export interface PreviewMeta {
  title: string;
  description: string;
  type: 'website' | 'article';
}

const SITE = 'The God Nation';

const DEFAULT: Record<Lang, PreviewMeta> = {
  en: {
    title: 'The God Nation — Leadership Academy',
    description: 'The God Nation: a community of disciples learning, praying and growing together. Leadership school, Dominion Clinic, chats and giving, in English and French.',
    type: 'website',
  },
  fr: {
    title: 'The God Nation — Académie de leadership',
    description: 'The God Nation : une communauté de disciples qui apprennent, prient et grandissent ensemble. École de leadership, Clinique de la Domination, discussions et dons, en français et en anglais.',
    type: 'website',
  },
};

const JOIN: Record<Lang, PreviewMeta> = {
  en: {
    title: 'Join The God Nation',
    description: 'Join a community of disciples online. Learn, pray and grow together, and be sent to make disciples who make disciples.',
    type: 'website',
  },
  fr: {
    title: 'Rejoignez The God Nation',
    description: 'Rejoignez une communauté de disciples en ligne. Apprenez, priez et grandissez ensemble, et soyez envoyés pour faire des disciples qui font des disciples.',
    type: 'website',
  },
};

const JOIN_PATHS = new Set(['/join', '/welcome', '/member/join', '/register']);

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A plain sentence from page text: markup and extra spaces removed, cut at a word. */
export function excerpt(text: string, max = 180): string {
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/[*_#>`~\[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function pageSlugOf(path: string): string | null {
  const m = /^\/page\/([a-z0-9-]+)\/?$/.exec(path);
  return m ? m[1] : null;
}

export function metaFor(path: string, lang: Lang, page?: { title: string; text: string } | null): PreviewMeta {
  if (page) return { title: `${page.title} — ${SITE}`, description: excerpt(page.text) || DEFAULT[lang].description, type: 'article' };
  if (JOIN_PATHS.has(path.replace(/\/+$/, '') || '/')) return JOIN[lang];
  return DEFAULT[lang];
}

/** The page with its title, description and share tags set for this link. Only the page's own path is used for the address, so a referral code in the link is never copied into it. */
export function renderIndexHtml(template: string, opts: { appUrl: string; path: string; lang: Lang; meta: PreviewMeta }): string {
  const { appUrl, path, lang, meta } = opts;
  const base = appUrl.replace(/\/+$/, '');
  const url = `${base}${path === '/' ? '' : path}` || base;
  const image = `${base}/og-image.png`;
  const t = escapeAttr(meta.title);
  const d = escapeAttr(meta.description);
  const tags = [
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_US'}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
  ].join('\n    ');

  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`);
  html = html.replace(/<meta\s+name="description"[\s\S]*?\/>/i, `<meta name="description" content="${d}" />`);
  html = html.replace(/<html lang="[a-z-]*"/i, `<html lang="${lang}"`);
  return html.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

type Lookup = (slug: string, lang: Lang) => Promise<{ title: string; text: string } | null>;

/** The handler for every page address that is not a file or an API call. */
export function spaHandler(template: string, appUrl: string, findPage: Lookup) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.path.startsWith('/api')) return next();
      const lang: Lang = req.query.lang === 'fr' ? 'fr' : 'en';
      const slug = pageSlugOf(req.path);
      const page = slug ? await findPage(slug, lang) : null;
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(renderIndexHtml(template, { appUrl, path: req.path, lang, meta: metaFor(req.path, lang, page) }));
    } catch (err) {
      next(err);
    }
  };
}
