import { APP_URL } from '../env';
import { CSS } from './style';
import {
  DIVISIONS, FR_REVIEWED, LANGS, MISSION, PAGE_META, SECTION, UI, VISION, WHAT_WE_DO,
  type Division, type Lang, type PageKey,
} from './content';

// Writes the public website's pages as complete HTML. Pure functions: no database, no
// cookies, no JavaScript. (Articles, which come from the database, arrive in Phase 3.)

export interface PageRef { key: PageKey; lang: Lang; division?: Division }

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const other = (l: Lang): Lang => (l === 'en' ? 'fr' : 'en');

export function pathOf(p: PageRef): string {
  const { key, lang: l, division } = p;
  const s = SECTION[l];
  switch (key) {
    case 'home': return `/${l}/`;
    case 'knowledge': return `/${l}/${s.knowledge}/`;
    case 'division': return `/${l}/${s.knowledge}/${division!.slug[l]}/`;
    case 'about': return `/${l}/${s.about}/`;
    case 'contact': return `/${l}/${s.contact}/`;
  }
}
export const urlOf = (p: PageRef) => `${APP_URL.replace(/\/+$/, '')}${pathOf(p)}`;

/** Whether this version may be indexed and linked as a public page. */
export function isIndexable(p: PageRef): boolean {
  if (p.lang === 'fr' && !FR_REVIEWED[p.key]) return false;
  if (p.key === 'division' && !p.division!.hasArticles) return false; // an empty area is a thin page
  return true;
}

/** Every public page version, for the sitemap and tests. */
export function allPages(): PageRef[] {
  const pages: PageRef[] = [];
  for (const lang of LANGS) {
    pages.push({ key: 'home', lang }, { key: 'knowledge', lang }, { key: 'about', lang }, { key: 'contact', lang });
    for (const division of DIVISIONS) pages.push({ key: 'division', lang, division });
  }
  return pages;
}

export function joinHref(lang: Lang, campaign: string): string {
  return `/member/join?utm_source=site&utm_medium=public&utm_campaign=${encodeURIComponent(campaign)}&lang=${lang}`;
}

function titleOf(p: PageRef): { title: string; description: string } {
  if (p.key === 'division') {
    const d = p.division!;
    return { title: `${d.name[p.lang]} — ${UI[p.lang].kcTitle} — The God Nation`, description: `${d.blurb[p.lang]} ${d.topics[p.lang].slice(0, 4).join(', ')}.` };
  }
  return PAGE_META[p.lang][p.key];
}

function crumbsOf(p: PageRef): { name: string; path: string }[] {
  const t = UI[p.lang];
  const home = { name: t.home, path: `/${p.lang}/` };
  if (p.key === 'home') return [];
  if (p.key === 'knowledge') return [home, { name: t.kcTitle, path: pathOf(p) }];
  if (p.key === 'division') return [home, { name: t.kcTitle, path: pathOf({ key: 'knowledge', lang: p.lang }) }, { name: p.division!.name[p.lang], path: pathOf(p) }];
  if (p.key === 'about') return [home, { name: t.aboutTitle, path: pathOf(p) }];
  return [home, { name: t.contactTitle, path: pathOf(p) }];
}

function head(p: PageRef): string {
  const t = UI[p.lang];
  const { title, description } = titleOf(p);
  const url = urlOf(p);
  const indexable = isIndexable(p);
  const o = other(p.lang);
  const oRef: PageRef = { ...p, lang: o };
  const alts: string[] = [];
  if (indexable) {
    alts.push(`<link rel="alternate" hreflang="${p.lang}" href="${url}">`);
    if (isIndexable(oRef)) alts.push(`<link rel="alternate" hreflang="${o}" href="${urlOf(oRef)}">`);
    const enRef: PageRef = { ...p, lang: 'en' };
    if (isIndexable(enRef)) alts.push(`<link rel="alternate" hreflang="x-default" href="${urlOf(enRef)}">`);
  }
  const org = { '@type': 'Organization', name: t.siteName, url: APP_URL, logo: `${APP_URL}/icons/icon-512.png`, description: MISSION[p.lang] };
  const ld: unknown[] = [];
  if (p.key === 'home') ld.push({ '@context': 'https://schema.org', ...org }, { '@context': 'https://schema.org', '@type': 'WebSite', name: t.siteName, url: `${APP_URL}/${p.lang}/`, inLanguage: p.lang });
  const crumbs = crumbsOf(p);
  if (crumbs.length) {
    ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${APP_URL}${c.path}` })) });
  }
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f2260">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${indexable ? '' : '<meta name="robots" content="noindex,follow">\n'}${alts.join('\n')}
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(t.siteName)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${APP_URL}/og-image.png"><meta property="og:locale" content="${p.lang === 'fr' ? 'fr_FR' : 'en_US'}">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<style>${CSS}</style>${ld.length ? `\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}`;
}

function header(p: PageRef): string {
  const t = UI[p.lang];
  const l = p.lang;
  const cur = (k: PageKey) => (p.key === k || (k === 'knowledge' && p.key === 'division') ? ' aria-current="page"' : '');
  const oRef: PageRef = { ...p, lang: other(l) };
  // The language switch appears only when the other language version is approved for the public.
  const sw = isIndexable(oRef) || (other(l) === 'en')
    ? `<a class="lang" href="${pathOf(oRef)}" hreflang="${other(l)}" lang="${other(l)}">${esc(t.langSwitch)}</a>` : '';
  return `<a class="skip" href="#content">${esc(t.skip)}</a>
<header class="site"><div class="bar"><a class="brand" href="/${l}/"><i aria-hidden="true"></i>${esc(t.siteName)}</a>
<nav class="main" aria-label="${esc(t.mainNav)}"><a href="${pathOf({ key: 'knowledge', lang: l })}"${cur('knowledge')}>${esc(t.navKnowledge)}</a><a href="${pathOf({ key: 'about', lang: l })}"${cur('about')}>${esc(t.navAbout)}</a><a href="${pathOf({ key: 'contact', lang: l })}"${cur('contact')}>${esc(t.navContact)}</a><a class="btn gold" style="padding:8px 14px;font-size:14px" href="${joinHref(l, p.key === 'division' ? p.division!.key : p.key)}">${esc(t.navJoin)}</a>${sw}</nav></div></header>`;
}

function crumbHtml(p: PageRef): string {
  const c = crumbsOf(p);
  if (!c.length) return '';
  const t = UI[p.lang];
  return `<nav class="crumb wrap" aria-label="${esc(t.breadcrumbs)}">${c.map((x, i) => (i === c.length - 1 ? `<span aria-current="page">${esc(x.name)}</span>` : `<a href="${x.path}">${esc(x.name)}</a>`)).join(' › ')}</nav>`;
}

function joinBand(p: PageRef): string {
  const t = UI[p.lang];
  return `<section class="join"><h2>${esc(t.joinTitle)}</h2><p>${esc(t.joinText)}</p><a class="btn gold" href="${joinHref(p.lang, p.key === 'division' ? p.division!.key : p.key)}">${esc(t.joinCta)}</a><small>${esc(t.joinMember)} <a href="/member/login">${esc(t.joinSignIn)}</a></small></section>`;
}

function footer(p: PageRef): string {
  const t = UI[p.lang];
  return `<footer class="site"><div class="bar"><span>© ${esc(t.rights)}</span><span><a href="${pathOf({ key: 'about', lang: p.lang })}">${esc(t.navAbout)}</a> · <a href="${pathOf({ key: 'contact', lang: p.lang })}">${esc(t.navContact)}</a> · <a href="/privacy">${esc(t.footerPrivacy)}</a> · <a href="/member/login">${esc(t.footerMembers)}</a></span></div></footer>`;
}

const divisionCards = (lang: Lang) =>
  DIVISIONS.map((d) => `<a class="card" href="${pathOf({ key: 'division', lang, division: d })}"><b>${esc(d.name[lang])}</b><span>${esc(d.blurb[lang])}</span></a>`).join('');

function body(p: PageRef): string {
  const t = UI[p.lang];
  const l = p.lang;
  switch (p.key) {
    case 'home':
      return `<section class="hero"><div class="in"><div class="kicker">${esc(t.heroKicker)}</div><h1>${esc(t.heroTitle)}</h1><p>${esc(MISSION[l])}</p>
<a class="btn gold" href="${pathOf({ key: 'knowledge', lang: l })}">${esc(t.heroCta)}</a><a class="btn line" href="${pathOf({ key: 'about', lang: l })}">${esc(t.heroCta2)}</a></div></section>
<main id="content"><section class="blk wrap"><div class="kicker dark">${esc(t.startHere)}</div><h2>${esc(t.areasTitle)}</h2><div class="grid two">${divisionCards(l)}</div></section>
<section class="blk wrap"><h2>${esc(t.whatTitle)}</h2><ul class="list read">${WHAT_WE_DO[l].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
<section class="blk wrap"><h2>${esc(t.ecoTitle)}</h2><div class="grid three"><div class="card"><b>${esc(t.ecoRead)}</b><span>${esc(t.ecoReadText)}</span></div><div class="card"><b>${esc(t.ecoLearn)}</b><span>${esc(t.ecoLearnText)}</span></div><div class="card"><b>${esc(t.ecoBelong)}</b><span>${esc(t.ecoBelongText)}</span></div></div></section></main>`;
    case 'knowledge':
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap"><div class="kicker dark">${esc(t.navKnowledge)}</div><h1>${esc(t.kcTitle)}</h1><p class="lead read">${esc(t.kcIntro)}</p><div class="grid two" style="margin-top:22px">${divisionCards(l)}</div></section></main>`;
    case 'division': {
      const d = p.division!;
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap"><div class="kicker dark">${esc(t.kcTitle)}</div><h1>${esc(d.name[l])}</h1><p class="lead read">${esc(d.blurb[l])}</p>
<h2 style="margin-top:26px">${esc(t.divCovers)}</h2><ul class="list read">${d.topics[l].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
${d.hasArticles ? '' : `<div class="callout read">${esc(t.divSoon)}</div>`}<p><a href="${pathOf({ key: 'knowledge', lang: l })}">← ${esc(t.divBack)}</a></p></section></main>`;
    }
    case 'about':
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap read"><h1>${esc(t.aboutTitle)}</h1><h2>${esc(t.aboutMission)}</h2><p class="lead">${esc(MISSION[l])}</p><h2>${esc(t.aboutVision)}</h2><p class="lead">${esc(VISION[l])}</p>
<h2>${esc(t.aboutWhat)}</h2><ul class="list">${WHAT_WE_DO[l].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h2 style="margin-top:28px">${esc(t.aboutHow)}</h2><p>${esc(t.aboutHowText1)}</p><p>${esc(t.aboutHowText2)}</p><p>${esc(t.aboutHowText3)}</p></section></main>`;
    case 'contact':
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap read"><h1>${esc(t.contactTitle)}</h1><p class="lead">${esc(t.contactIntro)}</p>
<div class="callout"><h3>${esc(t.contactForm)}</h3><p>${esc(t.contactFormText)}</p><a class="btn navy" href="/contact">${esc(t.contactForm)}</a></div>
<p><a href="/privacy">${esc(t.contactPrivacy)}</a></p></section></main>`;
  }
}

export function renderPage(p: PageRef): string {
  return `<!doctype html><html lang="${p.lang}"><head>${head(p)}</head><body>${header(p)}${body(p)}${joinBand(p)}${footer(p)}</body></html>`;
}

export function renderNotFound(lang: Lang): string {
  const t = UI[lang];
  const p: PageRef = { key: 'home', lang };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t.notFoundTitle)} — The God Nation</title><style>${CSS}</style></head><body>${header(p)}<main id="content"><section class="blk wrap read"><h1>${esc(t.notFoundTitle)}</h1><p class="lead">${esc(t.notFoundText)}</p><p><a class="btn navy" href="/${lang}/">${esc(t.notFoundHome)}</a></p></section></main>${footer(p)}</body></html>`;
}

export function sitemapXml(): string {
  const base = (r: PageRef) => ({ r, indexable: isIndexable(r) });
  const items = allPages().map(base).filter((x) => x.indexable);
  const urls = items.map(({ r }) => {
    const alts = LANGS.map((l) => ({ ...r, lang: l } as PageRef)).filter(isIndexable).map((x) => `<xhtml:link rel="alternate" hreflang="${x.lang}" href="${urlOf(x)}"/>`).join('');
    return `<url><loc>${urlOf(r)}</loc>${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>`;
}
