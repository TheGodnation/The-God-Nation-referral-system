// Link previews. When a link is shared in WhatsApp, Facebook, Telegram or
// X, those apps read the page's title, picture and sentence from the first
// HTML they get, without running any scripts. The app's pages are built in
// the browser, so every shared link used to show the same blank card. Here the
// right tags are written into the page before it is sent.

import type { NextFunction, Request, Response } from 'express';

type Lang = 'en' | 'fr';
/** The language of a shared link: ?lang=en, ?lang=fr, or neither (then the card shows both languages). */
export type CardLang = Lang | 'both';

export interface PreviewMeta {
  title: string;
  description: string;
  type: 'website' | 'article';
  /** A card picture of its own (a file in the site's public folder), instead of the usual one. */
  image?: string;
  imageAlt?: string;
}

const SITE = 'The God Nation';

// The picture of each card (drawn from docs/share-cards/cards.html). WhatsApp keeps a picture it has already
// fetched, so a new design gets new file names rather than replacing these files.
const CARD_IMAGE: Record<CardLang, string> = {
  both: 'share-card.jpg',
  en: 'share-card-en.jpg',
  fr: 'share-card-fr.jpg',
};
const CARD_ALT: Record<CardLang, string> = {
  both: 'The God Nation — Media & Leadership Academy · Académie des médias et du leadership',
  en: 'The God Nation — Media & Leadership Academy',
  fr: 'The God Nation — Académie des médias et du leadership',
};

/** The card picture for a link in this language. */
export function cardImageFile(lang: CardLang): string {
  return CARD_IMAGE[lang];
}

const DEFAULT: Record<CardLang, PreviewMeta> = {
  en: {
    title: 'The God Nation — Media & Leadership Academy',
    description: 'Go into the digital media spaces where billions gather. Make disciples who make disciples, taking the Gospel of the Kingdom to the ends of the earth.',
    type: 'website',
  },
  fr: {
    title: 'The God Nation — Académie des médias et du leadership',
    description: 'Allez dans les espaces des médias numériques où des milliards de personnes se rassemblent. Faites des disciples qui font des disciples, portant ainsi l’Évangile du Royaume jusqu’aux extrémités de la terre.',
    type: 'website',
  },
  both: {
    title: 'The God Nation — Media & Leadership Academy',
    description: 'Académie des médias et du leadership. Make disciples who make disciples · Faites des disciples qui font des disciples.',
    type: 'website',
  },
};

const JOIN: Record<CardLang, PreviewMeta> = {
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
  both: {
    title: 'Join The God Nation · Rejoignez The God Nation',
    description: 'Join a community of disciples online · Rejoignez une communauté de disciples en ligne. Make disciples who make disciples · Faites des disciples qui font des disciples.',
    type: 'website',
  },
};

// The "Congratulations" page for the students who finished the books. No names here: a link preview must never carry them.
const CELEBRATION: Record<CardLang, PreviewMeta> = {
  en: { title: 'Congratulations to our students! 🎉', description: 'They have completed all 15 books of The God Nation Media & Leadership Academy. Come and celebrate with us.', type: 'website', image: 'congratulations-card.jpg', imageAlt: 'Congratulations to our students — The God Nation' },
  fr: { title: 'Félicitations à nos étudiants ! 🎉', description: 'Ils ont terminé les 15 livres de The God Nation — Académie des médias et du leadership. Venez célébrer avec nous.', type: 'website', image: 'congratulations-card.jpg', imageAlt: 'Félicitations à nos étudiants — The God Nation' },
  both: { title: 'Congratulations to our students! · Félicitations à nos étudiants ! 🎉', description: 'They completed all 15 books · Ils ont terminé les 15 livres. Come and celebrate with us · Venez célébrer avec nous.', type: 'website', image: 'congratulations-card.jpg', imageAlt: 'Congratulations · Félicitations — The God Nation' },
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

export function metaFor(path: string, lang: CardLang, page?: { title: string; text: string } | null): PreviewMeta {
  if (page) return { title: `${page.title} — ${SITE}`, description: excerpt(page.text) || DEFAULT[lang].description, type: 'article' };
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/congratulations') return CELEBRATION[lang];
  if (JOIN_PATHS.has(clean)) return JOIN[lang];
  return DEFAULT[lang];
}

/** The page with its title, description and share tags set for this link. Only the page's own path is used for the address, so a referral code in the link is never copied into it. */
export function renderIndexHtml(template: string, opts: { appUrl: string; path: string; lang: CardLang; meta: PreviewMeta }): string {
  const { appUrl, path, lang, meta } = opts;
  const base = appUrl.replace(/\/+$/, '');
  const url = `${base}${path === '/' ? '' : path}` || base;
  const image = `${base}/${meta.image ?? CARD_IMAGE[lang]}`;
  const pageLang: Lang = lang === 'fr' ? 'fr' : 'en';
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
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:alt" content="${escapeAttr(meta.imageAlt ?? CARD_ALT[lang])}" />`,
    `<meta property="og:locale" content="${pageLang === 'fr' ? 'fr_FR' : 'en_US'}" />`,
    ...(lang === 'both' ? [`<meta property="og:locale:alternate" content="fr_FR" />`] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
  ].join('\n    ');

  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`);
  html = html.replace(/<meta\s+name="description"[\s\S]*?\/>/i, `<meta name="description" content="${d}" />`);
  html = html.replace(/<html lang="[a-z-]*"/i, `<html lang="${pageLang}"`);
  return html.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

type Lookup = (slug: string, lang: Lang) => Promise<{ title: string; text: string } | null>;

/** The handler for every page address that is not a file or an API call. */
export function spaHandler(template: string, appUrl: string, findPage: Lookup) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.path.startsWith('/api')) return next();
      // The link's own language decides the card (WhatsApp says nothing about who will read it).
      const lang: CardLang = req.query.lang === 'fr' ? 'fr' : req.query.lang === 'en' ? 'en' : 'both';
      const slug = pageSlugOf(req.path);
      const page = slug ? await findPage(slug, lang === 'fr' ? 'fr' : 'en') : null;
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(renderIndexHtml(template, { appUrl, path: req.path, lang, meta: metaFor(req.path, lang, page) }));
    } catch (err) {
      next(err);
    }
  };
}
