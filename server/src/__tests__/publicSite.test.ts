import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import zlib from 'node:zlib';
import { createApp } from '../app';
import fs from 'node:fs';
import path from 'node:path';
import { DIVISIONS, FR_APPROVAL, FR_REVIEWED, LANGS } from '../lib/publicSite/content';
import { allPages, isIndexable, pathOf, renderPage, sitemapXml, type Ctx } from '../lib/publicSite/render';
import { loadPublicContext } from '../lib/publicSite/articles';
import { BOOKS } from '../lib/publicSite/content';

// Phase 2 of the Knowledge Centre: the public website foundation (/en/…, /fr/…).
// It is off unless PUBLIC_SITE_ENABLED=true, serves complete cookie-free HTML, never serves
// an unreviewed French page as public, and leaves every existing address alone.

let appOn: ReturnType<typeof createApp>;
let appOff: ReturnType<typeof createApp>;
beforeAll(() => {
  process.env.PUBLIC_SITE_ENABLED = 'true';
  appOn = createApp();
  delete process.env.PUBLIC_SITE_ENABLED;
  appOff = createApp();
});

const SHIPPED = { ...FR_REVIEWED }; // as shipped, before any test changes them
// The site ships with French approved; these tests start every case from "not yet approved".
beforeEach(() => { for (const k of Object.keys(FR_REVIEWED) as (keyof typeof FR_REVIEWED)[]) FR_REVIEWED[k] = false; });
const everyPath = () => allPages().map((p) => pathOf(p));
afterEach(() => { for (const k of Object.keys(FR_REVIEWED) as (keyof typeof FR_REVIEWED)[]) FR_REVIEWED[k] = false; DIVISIONS.forEach((d) => { d.hasArticles = false; }); });

describe('The switch', () => {
  it('is off by default: nothing at /en or /fr is served by this feature', async () => {
    for (const p of ['/en/', '/fr/', '/en/about/', '/fr/a-propos/', '/sitemap-public.xml']) {
      const res = await request(appOff).get(p);
      expect(res.status, p).toBe(404);
      expect(res.text).not.toContain('Kingdom');
    }
  });

  it('when on, existing addresses are unchanged and still set their own cookies', async () => {
    const health = await request(appOn).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
    expect((health.headers['set-cookie'] ?? []).join(';')).toContain('visitor_id');
    const sitemap = await request(appOn).get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).not.toContain('/en/');
    expect((await request(appOn).get('/api/settings/public')).status).toBe(200);
  });
});

describe('Public pages', () => {
  it('every page is complete readable HTML with no scripts (only structured data) and a canonical address', async () => {
    for (const p of everyPath()) {
      const res = await request(appOn).get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      const lang = p.startsWith('/fr/') ? 'fr' : 'en';
      expect(res.headers['content-language']).toBe(lang);
      expect(res.text).toContain(`<html lang="${lang}">`);
      expect(res.text).toMatch(/<link rel="canonical" href="[^"]*\/(en|fr)\/[^"]*">/);
      expect(res.text).toContain('<h1>');
      expect(res.text).not.toMatch(/<script[^>]+src=/);
      const inline = [...res.text.matchAll(/<script([^>]*)>/g)].filter((m) => !m[1].includes('application/ld+json'));
      expect(inline, p).toEqual([]);
      expect(res.text).not.toMatch(/<div id="root">/);
    }
  });

  it('carries no cookies at all, so it can be cached safely', async () => {
    for (const p of everyPath()) {
      const res = await request(appOn).get(p);
      expect(res.headers['set-cookie'], p).toBeUndefined();
    }
    expect((await request(appOn).get('/en/does-not-exist/')).headers['set-cookie']).toBeUndefined();
  });

  it('says the ministry\'s own words: purpose and vision from the brief appear on the English About page', async () => {
    const res = await request(appOn).get('/en/about/');
    expect(res.text).toContain('exists to bring together citizens of the Kingdom of God');
    expect(res.text).toContain('make disciples who make disciples');
  });

  it('the About page carries the founder\'s seven sections in order, in English and in French', async () => {
    const en = (await request(appOn).get('/en/about/')).text;
    const heads = ['Who we are', 'Our calling', 'Our vision', 'Our vision in action', 'Our mission', 'Our motto', 'Our scriptural foundation'];
    const at = heads.map((h) => en.indexOf(`<h2>${h}</h2>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(en).toContain('spiritual visitations and divine dealings with my family');
    expect(en).toContain('Go into the digital media spaces where billions gather.');
    expect(en).toContain('Matthew 28:19');
    expect(en).toContain('<li>Digital books and publications.</li>');
    const fr = (await request(appOn).get('/fr/a-propos/')).text;
    for (const h of ['Qui nous sommes', 'Notre appel', 'Notre vision', 'Notre vision en action', 'Notre mission', 'Notre devise', 'Notre fondement biblique']) expect(fr).toContain(`<h2>${h}</h2>`);
    expect(fr).toContain('Matthieu 28.19');
  });

  it('every public page footer links to the Terms of Use (and the Privacy page), in the page\'s own language', async () => {
    const en = (await request(appOn).get('/en/')).text;
    expect(en).toContain('<a href="/terms">Terms of Use</a>');
    expect(en).toContain('<a href="/privacy">Privacy</a>');
    const fr = (await request(appOn).get('/fr/a-propos/')).text;
    expect(fr).toContain('<a href="/terms">Conditions d’utilisation</a>');
  });

  it('home carries Organization and WebSite data; inner pages carry a breadcrumb; the data parses and claims nothing extra', async () => {
    const home = await request(appOn).get('/en/');
    const ld = JSON.parse(/application\/ld\+json">(.*?)<\/script>/s.exec(home.text)![1]);
    expect(ld.map((x: any) => x['@type'])).toEqual(['Organization', 'WebSite']);
    expect(JSON.stringify(ld)).not.toContain('sameAs');
    const about = await request(appOn).get('/en/about/');
    const ld2 = JSON.parse(/application\/ld\+json">(.*?)<\/script>/s.exec(about.text)![1]);
    expect(ld2[0]['@type']).toBe('BreadcrumbList');
    expect(ld2[0].itemListElement).toHaveLength(2);
  });

  it('stays within the page-weight budget', async () => {
    for (const p of everyPath()) {
      const res = await request(appOn).get(p);
      const bytes = Buffer.byteLength(res.text);
      expect(bytes, p).toBeLessThan(30 * 1024);
      expect(zlib.gzipSync(res.text).length, p).toBeLessThan(8 * 1024);
    }
  });

  it('has no private data in any page (no e-mail addresses, storage keys or tokens)', async () => {
    for (const p of everyPath()) {
      const res = await request(appOn).get(p);
      expect(res.text, p).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
      expect(res.text, p).not.toMatch(/storageKey|passwordHash|csrf|token=/i);
    }
  });

  it('every link on every page leads somewhere that exists', async () => {
    const outside = new Set(['/privacy', '/terms', '/contact', '/member/login']);
    const checked = new Set<string>();
    for (const p of everyPath()) {
      const res = await request(appOn).get(p);
      for (const m of res.text.matchAll(/href="([^"#]+)"/g)) {
        const href = m[1];
        if (/^https?:|^mailto:/.test(href) || href.startsWith('/icons/')) continue;
        const key = href.split('?')[0];
        if (checked.has(href)) continue;
        checked.add(href);
        if (key.startsWith('/en/') || key.startsWith('/fr/')) {
          const r = await request(appOn).get(key);
          expect([200, 301, 302], `${p} -> ${href}`).toContain(r.status);
        } else if (key === '/member/join') {
          expect(href).toMatch(/^\/member\/join\?utm_source=site&utm_medium=public&utm_campaign=[a-z-]+&lang=(en|fr)$/);
        } else {
          expect(outside.has(key), `${p} -> ${href}`).toBe(true);
        }
      }
    }
    expect(checked.size).toBeGreaterThan(20);
  });
});

describe('The French review gate', () => {
  it('unreviewed French pages are noindex, have no language links, are left out of the sitemap, and are not offered from English pages', async () => {
    const fr = await request(appOn).get('/fr/');
    expect(fr.status).toBe(200);
    expect(fr.text).toContain('<meta name="robots" content="noindex,follow">');
    expect(fr.text).not.toContain('hreflang="en" href');
    const en = await request(appOn).get('/en/');
    expect(en.text).not.toContain('hreflang="fr"');
    expect(en.text).not.toContain('Lire en français');
    expect(sitemapXml()).not.toContain('/fr/');
    expect(fr.text).toContain('Read in English'); // French readers can always go to the English page
  });

  it('once reviewed, the pair is linked both ways, indexable and in the sitemap', () => {
    FR_REVIEWED.home = true;
    const enRef = { key: 'home', lang: 'en' } as const;
    const frRef = { key: 'home', lang: 'fr' } as const;
    expect(isIndexable(frRef)).toBe(true);
    const en = renderPage(enRef);
    const fr = renderPage(frRef);
    expect(en).toContain('hreflang="fr"');
    expect(en).toContain('Lire en français');
    expect(fr).not.toContain('noindex');
    expect(fr).toContain('hreflang="en"');
    expect(fr).toContain('hreflang="x-default"');
    const sm = sitemapXml();
    expect(sm).toContain('/fr/</loc>');
    expect(sm).toContain('hreflang="fr"');
  });

  it('an empty knowledge area is noindex and out of the sitemap until it has articles', () => {
    const d = DIVISIONS[0];
    expect(isIndexable({ key: 'division', lang: 'en', division: d })).toBe(false);
    expect(renderPage({ key: 'division', lang: 'en', division: d })).toContain('noindex');
    expect(sitemapXml()).not.toContain(d.slug.en);
    d.hasArticles = true;
    expect(isIndexable({ key: 'division', lang: 'en', division: d })).toBe(true);
    expect(sitemapXml()).toContain(d.slug.en);
  });

  it('the public sitemap lists only approved pages, with their language alternates', async () => {
    const res = await request(appOn).get('/sitemap-public.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    expect(locs.sort()).toEqual(['/en/', '/en/about/', '/en/books/the-doorway-into-the-kingdom/', '/en/books/the-restoration-of-dominion/', '/en/contact/', '/en/knowledge/']);
  });
});

describe('Addresses', () => {
  it('missing pages in the public area are a real 404 (not the app\'s empty page), noindex and in the right language', async () => {
    for (const [p, lang] of [['/en/nope/', 'en'], ['/fr/nope/', 'fr'], ['/en/knowledge/not-a-division/', 'en'], ['/fr/connaissance/connaissance-du-royaume/x/', 'fr']] as const) {
      const res = await request(appOn).get(p);
      expect(res.status, p).toBe(404);
      expect(res.text).toContain('noindex');
      expect(res.text).toContain(`<html lang="${lang}">`);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('an address without the closing slash moves to the one with it (query kept), permanently', async () => {
    for (const [from, to] of [['/en', '/en/'], ['/fr', '/fr/'], ['/en/about', '/en/about/'], ['/fr/a-propos?x=1', '/fr/a-propos/?x=1']]) {
      const res = await request(appOn).get(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.location).toBe(to);
    }
  });

  it('the friendly Join and Sign-in addresses lead to the existing systems', async () => {
    const j = await request(appOn).get('/en/join/');
    expect(j.status).toBe(302);
    expect(j.headers.location).toBe('/member/join?utm_source=site&utm_medium=public&utm_campaign=join-page&lang=en');
    expect((await request(appOn).get('/fr/rejoindre/')).headers.location).toBe('/member/join?utm_source=site&utm_medium=public&utm_campaign=join-page&lang=fr');
    expect((await request(appOn).get('/fr/connexion/')).headers.location).toBe('/member/login');
    expect((await request(appOn).get('/en/login/')).headers.location).toBe('/member/login');
  });

  it('division addresses are unique in each language and never collide with an existing address', () => {
    for (const lang of LANGS) {
      const slugs = DIVISIONS.map((d) => d.slug[lang]);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
    for (const p of everyPath()) expect(/^\/(en|fr)\//.test(p)).toBe(true);
  });

  it('a division page lists what the area covers, in its own language', async () => {
    const d = DIVISIONS[0];
    const en = await request(appOn).get(`/en/knowledge/${d.slug.en}/`);
    expect(en.text).toContain('Identity in Christ');
    const fr = await request(appOn).get(`/fr/connaissance/${d.slug.fr}/`);
    expect(fr.text).toContain('L’identité en Christ');
  });
});

describe('As shipped', () => {
  it('has French approved by the founder (recorded), so French pages go live with the English ones', () => {
    expect(Object.values(SHIPPED).every(Boolean)).toBe(true);
    expect(FR_APPROVAL.by).toBe('Evangelist Stanley A. Ndoh');
    expect(FR_APPROVAL.note).toMatch(/corrections to follow/);
  });

  it('robots.txt opens the public pages, keeps crawlers out of private areas, and lists both sitemaps', () => {
    const robots = fs.readFileSync(path.join(__dirname, '../../../client/public/robots.txt'), 'utf8');
    for (const line of ['Allow: /', 'Allow: /member/join', 'Allow: /member/login', 'Disallow: /api/', 'Disallow: /admin/', 'Disallow: /leader/', 'Disallow: /member/', 'Sitemap: https://thegodnationacademy.org/sitemap.xml', 'Sitemap: https://thegodnationacademy.org/sitemap-public.xml']) {
      expect(robots, line).toContain(line);
    }
    expect(robots).not.toMatch(/Disallow:\s*\/en|Disallow:\s*\/fr/);
  });
});


describe('Book pages: cover, description and chapter summaries, never the book', () => {
  const chapters = [
    { titleEn: 'The Government of God', titleFr: 'Le gouvernement de Dieu', summaryEn: 'Why a kingdom needs a king.\n\nWho rules.', summaryFr: 'Pourquoi un royaume a besoin d’un roi.' },
    { titleEn: 'Citizens', titleFr: null, summaryEn: null, summaryFr: null },
  ];
  const ctx: Ctx = { articles: [], books: [{ key: 'restoration-of-dominion', chapters }] };
  const page = (lang: 'en' | 'fr', key = 'restoration-of-dominion', c: Ctx = ctx) => renderPage({ key: 'book', lang, book: BOOKS.find((b) => b.key === key)! }, c);

  it('shows the cover, the summaries in order, and a way to join, with no reading text', () => {
    const html = page('en');
    expect(html).toContain('/site/book1-en.webp');
    expect(html).toContain('<h1>The Restoration of Dominion</h1>');
    expect(html.indexOf('The Government of God')).toBeLessThan(html.indexOf('Citizens'));
    expect(html).toContain('<p>Why a kingdom needs a king.</p><p>Who rules.</p>');
    expect(html).toContain('utm_campaign=book-restoration-of-dominion');
    expect(html).toContain('"@type":"Book"');
    expect(html).not.toMatch(/<script(?![^>]*ld\+json)/); // still no scripts
    expect(Buffer.byteLength(html)).toBeLessThan(30_000);
  });

  it('a French page shows only chapters written in French, never English text', () => {
    const html = page('fr');
    expect(html).toContain('Le gouvernement de Dieu');
    expect(html).toContain('Pourquoi un royaume a besoin d’un roi.');
    expect(html).not.toContain('Citizens'); // no French title: left out
    expect(html).not.toContain('Why a kingdom needs a king');
    expect(html).toContain('<html lang="fr">');
  });

  it('a book the app does not hold yet has no chapter section, and claims nothing', () => {
    const html = page('en', 'doorway-into-the-kingdom');
    expect(html).not.toContain('Chapter summaries');
    expect(html).not.toContain('Join to read it'); // not in the school yet
    expect(html).toContain('The Doorway into the Kingdom');
  });

  it('reads chapters from the app by title (an exact or longer title matches), and survives a database error', async () => {
    const make = (rows: unknown[] | Error) => ({
      knowledgeArticle: { findMany: async () => [] },
      knowledgeMedia: { findMany: async () => [] },
      libraryBook: { findMany: async () => { if (rows instanceof Error) throw rows; return rows; } },
    }) as never;
    const row = (titleEn: string) => ({ titleEn, titleFr: null, chapters });
    expect((await loadPublicContext(make([row('Book One: The Restoration of Dominion')]))).books).toEqual([{ key: 'restoration-of-dominion', chapters }]);
    expect((await loadPublicContext(make([row('Something else entirely')]))).books).toEqual([]);
    expect((await loadPublicContext(make(new Error('down')))).books).toEqual([]);
  });

  it('the shelf links each book to its page, and the pages are in the sitemap for both languages', () => {
    const home = renderPage({ key: 'home', lang: 'en' }, ctx);
    expect(home).toContain('/en/books/the-restoration-of-dominion/');
    expect(home).toContain('/en/books/the-doorway-into-the-kingdom/');
    expect(sitemapXml(ctx)).not.toContain('/fr/livres/'); // French pages join the sitemap only once approved
    FR_REVIEWED.book = true;
    const xml = sitemapXml(ctx);
    expect(xml).toContain('/fr/livres/la-restauration-de-la-domination/');
    expect(xml).toContain('/en/books/the-restoration-of-dominion/');
  });
});
