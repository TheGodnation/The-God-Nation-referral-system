import { APP_URL } from '../env';
import { CSS, CSS_ARTICLES } from './style';
import { headingsOf, renderBody } from './text';
import {
  ABOUT, BOOKS, DIVISIONS, FOUNDER, founderName, FR_REVIEWED, LANGS, MISSION, MOTTO, PAGE_META, PHOTOS, SECTION, UI, VISION, WHAT_WE_DO,
  type Division, type Lang, type PageKey, type SiteBook,
} from './content';

// Writes the public website's pages as complete HTML. Pure functions: no database, no
// cookies, no JavaScript. (Articles, which come from the database, arrive in Phase 3.)

export interface PublicTr {
  slug: string; title: string; summary: string; body: string;
  seoTitle?: string | null; seoDescription?: string | null; readingMinutes: number;
  faq?: { q: string; a: string }[] | null;
}
/** A published article, with only the languages that a person has reviewed. Never holds anything private. */
export interface PublicArticle {
  id: string; divisionKey: string; publishedAt: Date; updatedAt: Date;
  authorName: string | null; authorBio: Partial<Record<Lang, string | null>>;
  imageUrl: string | null; imageSize?: { w: number; h: number }; imageAlt: Partial<Record<Lang, string | null>>;
  tr: Partial<Record<Lang, PublicTr>>; relatedIds: string[];
}
/** What the app holds about one of the books: its chapters and their summaries (never the book itself). */
export interface PublicBook {
  key: string;
  chapters: { titleEn: string; titleFr: string | null; summaryEn: string | null; summaryFr: string | null }[];
}
export interface Ctx { articles: PublicArticle[]; books?: PublicBook[] }
export const EMPTY_CTX: Ctx = { articles: [] };

export interface PageRef { key: PageKey; lang: Lang; division?: Division; article?: PublicArticle; book?: SiteBook }

export const divisionOf = (key: string): Division | undefined => DIVISIONS.find((d) => d.key === key);
/** Public articles in a language (newest first), optionally within one area. */
export function articlesOf(ctx: Ctx, lang: Lang, divisionKey?: string): PublicArticle[] {
  return ctx.articles
    .filter((a) => a.tr[lang] && divisionOf(a.divisionKey) && (!divisionKey || a.divisionKey === divisionKey))
    .sort((x, y) => y.publishedAt.getTime() - x.publishedAt.getTime());
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const other = (l: Lang): Lang => (l === 'en' ? 'fr' : 'en');

/** The About page in the founder's own words: who we are, calling, vision, vision in action, mission, motto and scripture. */
function aboutBody(l: Lang): string {
  const a = ABOUT[l];
  const paras = (xs: string[]) => xs.map((x) => `<p>${esc(x)}</p>`).join('');
  return `<h2>${esc(a.who.title)}</h2>${paras(a.who.paras)}<h2>${esc(a.calling.title)}</h2>${paras(a.calling.paras)}<h2>${esc(a.vision.title)}</h2>${paras(a.vision.paras)}<h2>${esc(a.action.title)}</h2><p>${esc(a.action.intro)}</p><ul class="list">${a.action.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>${esc(a.action.closing)}</p><h2>${esc(a.mission.title)}</h2><p class="lead">${esc(a.mission.text)}</p><h2>${esc(a.motto.title)}</h2><p class="lead"><b>${esc(a.motto.lead)}</b></p><p>${esc(a.motto.text)}</p><h2>${esc(a.scripture.title)}</h2><div class="prose"><blockquote><p>${esc(a.scripture.quote)} — ${esc(a.scripture.ref)}</p></blockquote></div>`;
}

export function pathOf(p: PageRef): string {
  const { key, lang: l, division } = p;
  const s = SECTION[l];
  switch (key) {
    case 'home': return `/${l}/`;
    case 'knowledge': return `/${l}/${s.knowledge}/`;
    case 'division': return `/${l}/${s.knowledge}/${division!.slug[l]}/`;
    case 'book': return `/${l}/${s.books}/${p.book!.slug[l]}/`;
    case 'about': return `/${l}/${s.about}/`;
    case 'contact': return `/${l}/${s.contact}/`;
    case 'article': return `/${l}/${s.knowledge}/${divisionOf(p.article!.divisionKey)!.slug[l]}/${p.article!.tr[l]!.slug}/`;
  }
}
export const urlOf = (p: PageRef) => `${APP_URL.replace(/\/+$/, '')}${pathOf(p)}`;

/** Whether this version may be indexed and linked as a public page. */
export function isIndexable(p: PageRef, ctx: Ctx = EMPTY_CTX): boolean {
  if (p.key === 'article') return Boolean(p.article!.tr[p.lang]); // only reviewed versions exist in the public set
  if (p.lang === 'fr' && !FR_REVIEWED[p.key]) return false;
  if (p.key === 'division' && !p.division!.hasArticles && articlesOf(ctx, p.lang, p.division!.key).length === 0) return false; // an empty area is a thin page
  return true;
}

/** Every public page version, for the sitemap and tests. */
export function allPages(): PageRef[] {
  const pages: PageRef[] = [];
  for (const lang of LANGS) {
    pages.push({ key: 'home', lang }, { key: 'knowledge', lang }, { key: 'about', lang }, { key: 'contact', lang });
    for (const division of DIVISIONS) pages.push({ key: 'division', lang, division });
    for (const book of BOOKS) pages.push({ key: 'book', lang, book });
  }
  return pages;
}

export function joinHref(lang: Lang, campaign: string): string {
  return `/member/join?utm_source=site&utm_medium=public&utm_campaign=${encodeURIComponent(campaign)}&lang=${lang}`;
}

const fmtDate = (d: Date, lang: Lang) => d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function titleOf(p: PageRef): { title: string; description: string } {
  if (p.key === 'division') {
    const d = p.division!;
    return { title: `${d.name[p.lang]} — ${UI[p.lang].kcTitle} — The God Nation`, description: `${d.blurb[p.lang]} ${d.topics[p.lang].slice(0, 4).join(', ')}.` };
  }
  if (p.key === 'book') {
    const b = p.book!;
    return { title: `${b.title[p.lang]} — ${b.series[p.lang]} — The God Nation`, description: `${b.subtitle[p.lang]} ${b.tagline[p.lang]}` };
  }
  if (p.key === 'article') {
    const tr = p.article!.tr[p.lang]!;
    return { title: `${tr.seoTitle || tr.title} — The God Nation`, description: tr.seoDescription || tr.summary };
  }
  return PAGE_META[p.lang][p.key];
}

function crumbsOf(p: PageRef): { name: string; path: string }[] {
  const t = UI[p.lang];
  const home = { name: t.home, path: `/${p.lang}/` };
  if (p.key === 'home') return [];
  if (p.key === 'knowledge') return [home, { name: t.kcTitle, path: pathOf(p) }];
  if (p.key === 'division') return [home, { name: t.kcTitle, path: pathOf({ key: 'knowledge', lang: p.lang }) }, { name: p.division!.name[p.lang], path: pathOf(p) }];
  if (p.key === 'article') {
    const d = divisionOf(p.article!.divisionKey)!;
    return [home, { name: t.kcTitle, path: pathOf({ key: 'knowledge', lang: p.lang }) }, { name: d.name[p.lang], path: pathOf({ key: 'division', lang: p.lang, division: d }) }, { name: p.article!.tr[p.lang]!.title, path: pathOf(p) }];
  }
  if (p.key === 'book') {
    const d = DIVISIONS.find((x) => x.key === 'books-publications')!;
    return [home, { name: t.kcTitle, path: pathOf({ key: 'knowledge', lang: p.lang }) }, { name: d.name[p.lang], path: pathOf({ key: 'division', lang: p.lang, division: d }) }, { name: p.book!.title[p.lang], path: pathOf(p) }];
  }
  if (p.key === 'about') return [home, { name: t.aboutTitle, path: pathOf(p) }];
  return [home, { name: t.contactTitle, path: pathOf(p) }];
}

/** The other-language version of the same page, if a person has approved it for the public. */
function counterpart(p: PageRef, ctx: Ctx): PageRef | null {
  const o = other(p.lang);
  const ref: PageRef = { ...p, lang: o };
  if (p.key === 'article') return p.article!.tr[o] ? ref : null;
  return isIndexable(ref, ctx) ? ref : null;
}

function campaignOf(p: PageRef): string {
  if (p.key === 'division') return p.division!.key;
  if (p.key === 'book') return `book-${p.book!.key}`;
  if (p.key === 'article') return (p.article!.tr.en ?? p.article!.tr[p.lang]!).slug;
  return p.key;
}

function articleLd(p: PageRef, url: string): unknown[] {
  const a = p.article!;
  const tr = a.tr[p.lang]!;
  const t = UI[p.lang];
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org', '@type': 'Article', headline: tr.title, description: tr.seoDescription || tr.summary, inLanguage: p.lang,
    datePublished: a.publishedAt.toISOString(), dateModified: a.updatedAt.toISOString(), mainEntityOfPage: url,
    publisher: { '@type': 'Organization', name: t.siteName, url: APP_URL },
  };
  if (a.authorName) ld.author = { '@type': 'Person', name: a.authorName };
  if (a.imageUrl && a.imageAlt[p.lang]) ld.image = a.imageUrl.startsWith('/') ? `${APP_URL}${a.imageUrl}` : a.imageUrl;
  const out: unknown[] = [ld];
  if (tr.faq && tr.faq.length) {
    out.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: tr.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  }
  return out;
}

function head(p: PageRef, ctx: Ctx): string {
  const t = UI[p.lang];
  const { title, description } = titleOf(p);
  const url = urlOf(p);
  const indexable = isIndexable(p, ctx);
  const o = other(p.lang);
  const alts: string[] = [];
  const cp = counterpart(p, ctx);
  if (indexable) {
    alts.push(`<link rel="alternate" hreflang="${p.lang}" href="${url}">`);
    if (cp) alts.push(`<link rel="alternate" hreflang="${o}" href="${urlOf(cp)}">`);
    const enRef: PageRef = p.lang === 'en' ? p : cp && cp.lang === 'en' ? cp : null as unknown as PageRef;
    if (enRef) alts.push(`<link rel="alternate" hreflang="x-default" href="${urlOf(enRef)}">`);
  }
  const org = { '@type': 'Organization', name: t.siteName, url: APP_URL, logo: `${APP_URL}/icons/icon-512.png`, description: MISSION[p.lang], founder: { '@type': 'Person', name: FOUNDER.name } };
  const ld: unknown[] = [];
  if (p.key === 'home') ld.push({ '@context': 'https://schema.org', ...org }, { '@context': 'https://schema.org', '@type': 'WebSite', name: t.siteName, url: `${APP_URL}/${p.lang}/`, inLanguage: p.lang });
  if (p.key === 'article') ld.push(...articleLd(p, url));
  if (p.key === 'book') {
    const b = p.book!;
    ld.push({ '@context': 'https://schema.org', '@type': 'Book', name: b.title[p.lang], description: b.subtitle[p.lang], inLanguage: p.lang, url, image: `${APP_URL}${b.cover[p.lang].src}`, author: { '@type': 'Person', name: FOUNDER.name }, publisher: { '@type': 'Organization', name: t.siteName, url: APP_URL }, isPartOf: { '@type': 'BookSeries', name: b.series[p.lang] } });
  }
  const crumbs = crumbsOf(p);
  if (crumbs.length) {
    ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${APP_URL}${c.path}` })) });
  }
  const og = p.key === 'book' ? `${APP_URL}${p.book!.cover[p.lang].src}` : p.key === 'article' && p.article!.imageUrl && p.article!.imageAlt[p.lang] ? (p.article!.imageUrl.startsWith('/') ? `${APP_URL}${p.article!.imageUrl}` : p.article!.imageUrl) : `${APP_URL}/og-image.png`;
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f2260">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${indexable ? '' : '<meta name="robots" content="noindex,follow">\n'}${alts.join('\n')}
<meta property="og:type" content="${p.key === 'article' ? 'article' : 'website'}"><meta property="og:site_name" content="${esc(t.siteName)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${esc(og)}"><meta property="og:locale" content="${p.lang === 'fr' ? 'fr_FR' : 'en_US'}">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<style>${CSS}${p.key === 'article' || p.key === 'division' || p.key === 'knowledge' || p.key === 'home' || p.key === 'book' ? CSS_ARTICLES : ''}</style>${ld.length ? `\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}`;
}

function header(p: PageRef, ctx: Ctx): string {
  const t = UI[p.lang];
  const l = p.lang;
  const cur = (k: PageKey) => (p.key === k || (k === 'knowledge' && (p.key === 'division' || p.key === 'article')) ? ' aria-current="page"' : '');
  const cp = counterpart(p, ctx);
  // The language switch appears only when the other language version is approved for the public
  // (a French reader can always go to the English page).
  const sw = cp ? `<a class="lang" href="${pathOf(cp)}" hreflang="${cp.lang}" lang="${cp.lang}" aria-label="${esc(p.key === 'article' ? t.readOther : t.langSwitch)}"><span class="ll">${esc(p.key === 'article' ? t.readOther : t.langSwitch)}</span><span class="ls" aria-hidden="true">${cp.lang.toUpperCase()}</span></a>` : '';
  return `<a class="skip" href="#content">${esc(t.skip)}</a>
<header class="site"><div class="bar"><a class="brand" href="/${l}/"><img src="/icons/icon-192.png" width="34" height="34" alt="">${esc(t.siteName)}</a>
${sw}<a class="btn gold top-join" href="${joinHref(l, campaignOf(p))}"><span class="jl">${esc(t.navJoin)}</span><span class="js">${esc(t.navJoinShort)}</span></a>
<nav class="main" aria-label="${esc(t.mainNav)}"><a href="${pathOf({ key: 'knowledge', lang: l })}"${cur('knowledge')}>${esc(t.navKnowledge)}</a><a href="${pathOf({ key: 'about', lang: l })}"${cur('about')}>${esc(t.navAbout)}</a><a href="${pathOf({ key: 'contact', lang: l })}"${cur('contact')}>${esc(t.navContact)}</a></nav></div></header>`;
}

function crumbHtml(p: PageRef): string {
  const c = crumbsOf(p);
  if (!c.length) return '';
  const t = UI[p.lang];
  return `<nav class="crumb wrap" aria-label="${esc(t.breadcrumbs)}">${c.map((x, i) => (i === c.length - 1 ? `<span aria-current="page">${esc(x.name)}</span>` : `<a href="${x.path}">${esc(x.name)}</a>`)).join(' › ')}</nav>`;
}

function joinBand(p: PageRef): string {
  const t = UI[p.lang];
  return `<section class="join"><h2>${esc(t.joinTitle)}</h2><p>${esc(t.joinText)}</p><a class="btn gold" href="${joinHref(p.lang, campaignOf(p))}">${esc(t.joinCta)}</a><small>${esc(t.joinMember)} <a href="/member/login">${esc(t.joinSignIn)}</a></small></section>`;
}

function footer(p: PageRef): string {
  const t = UI[p.lang];
  const l = p.lang;
  const areas = DIVISIONS.map((d) => `<a href="${pathOf({ key: 'division', lang: l, division: d })}">${esc(d.name[l])}</a>`).join('');
  return `<footer class="site"><div class="fcols"><div><div class="fbrand"><img src="/icons/icon-192.png" width="34" height="34" alt="">${esc(t.siteName)}</div><p>${esc(MISSION[l])}</p></div>
<div><b>${esc(t.navKnowledge)}</b>${areas}</div>
<div><b>${esc(t.footerMore)}</b><a href="${pathOf({ key: 'about', lang: l })}">${esc(t.navAbout)}</a><a href="${pathOf({ key: 'contact', lang: l })}">${esc(t.navContact)}</a><a href="/privacy">${esc(t.footerPrivacy)}</a><a href="/terms">${esc(t.footerTerms)}</a><a href="${joinHref(l, campaignOf(p))}">${esc(t.navJoin)}</a><a href="/member/login">${esc(t.footerMembers)}</a></div></div>
<div class="fbase"><span>© ${esc(t.rights)}</span></div></footer>`;
}

const photo = (ph: import('./content').SitePhoto, lang: Lang, o: { eager?: boolean; caption?: string } = {}) =>
  `<figure class="photo"><img src="${esc(ph.src)}" width="${ph.w}" height="${ph.h}" alt="${esc(ph.alt[lang])}" decoding="async"${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'}>${o.caption ? `<figcaption>${o.caption}</figcaption>` : o.caption === undefined && ph.caption ? `<figcaption>${esc(ph.caption[lang])}</figcaption>` : ''}</figure>`;

/** The Kingdom Series with its real covers (in the visitor's language). */
function bookShelf(lang: Lang, withMore: boolean): string {
  const t = UI[lang];
  const books = BOOKS.map((b) => {
    const c = b.cover[lang];
    return `<article class="bk"><img src="${esc(c.src)}" width="${c.w}" height="${c.h}" alt="${esc(`${b.title[lang]} — ${b.series[lang]}`)}" loading="lazy" decoding="async"><div class="bt"><span class="s">${esc(b.series[lang])}</span><h3>${esc(b.title[lang])}</h3><p class="sub">${esc(b.subtitle[lang])}</p><p class="by">${esc(t.bookBy)} ${esc(founderName(lang))}</p>${b.inSchool ? `<a class="btn gold" href="${joinHref(lang, 'book-' + b.key)}">${esc(t.bookCta)}</a> ` : ''}<a class="btn line" href="${pathOf({ key: 'book', lang, book: b })}">${esc(t.bookDetails)}</a></div></article>`;
  }).join('');
  const more = withMore ? `<a class="btn line" href="${pathOf({ key: 'division', lang, division: DIVISIONS.find((d) => d.key === 'books-publications')! })}">${esc(t.bookMore)}</a>` : '';
  return `<section class="shelf"><div class="wrap"><div class="kicker">${esc(t.bookKicker)}</div><h2>${esc(t.bookShelfTitle)}</h2><div class="books">${books}</div><p class="note">${esc(t.bookText)}</p>${more}</div></section>`;
}

const divisionCards = (lang: Lang) =>
  DIVISIONS.map((d, i) => `<a class="card area" href="${pathOf({ key: 'division', lang, division: d })}"><i class="num" aria-hidden="true">0${i + 1}</i><b>${esc(d.name[lang])}</b><span>${esc(d.blurb[lang])}</span></a>`).join('');

function articleCards(list: PublicArticle[], lang: Lang): string {
  const t = UI[lang];
  return `<ul class="cards">${list
    .map((a) => {
      const tr = a.tr[lang]!;
      const d = divisionOf(a.divisionKey)!;
      return `<li><a class="card" href="${pathOf({ key: 'article', lang, article: a })}"><span class="kicker dark" style="font-size:11px">${esc(d.name[lang])}</span><b>${esc(tr.title)}</b><span>${esc(tr.summary)}</span><span class="meta">${a.authorName ? `${esc(a.authorName)} · ` : ''}${fmtDate(a.publishedAt, lang)} · ${tr.readingMinutes} ${esc(t.minRead)}</span></a></li>`;
    })
    .join('')}</ul>`;
}

function articleBody(p: PageRef, ctx: Ctx): string {
  const t = UI[p.lang];
  const l = p.lang;
  const a = p.article!;
  const tr = a.tr[l]!;
  const url = urlOf(p);
  const heads = headingsOf(tr.body);
  const toc = heads.length >= 3 ? `<nav class="toc" aria-label="${esc(t.inThisArticle)}"><b>${esc(t.inThisArticle)}</b>${heads.map((h) => `<a href="#${h.id}">${esc(h.text)}</a>`).join('<br>')}</nav>` : '';
  const img = a.imageUrl && a.imageAlt[l] ? `<img class="hero-img" src="${esc(a.imageUrl)}"${a.imageSize ? ` width="${a.imageSize.w}" height="${a.imageSize.h}"` : ''} alt="${esc(a.imageAlt[l]!)}" decoding="async" fetchpriority="high">` : '';
  const faq = tr.faq && tr.faq.length ? `<h2>${esc(t.faqTitle)}</h2>${tr.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><div>${esc(f.a)}</div></details>`).join('')}` : '';
  const rel = a.relatedIds.map((id) => ctx.articles.find((x) => x.id === id)).filter((x): x is PublicArticle => Boolean(x && x.tr[l])).slice(0, 3);
  const who = a.authorName ? `<div class="who"><b>${esc(a.authorName)}</b>${a.authorBio[l] ? esc(a.authorBio[l]!) : ''}</div>` : '';
  const share = `<div class="share" aria-label="${esc(t.shareTitle)}"><a class="wa" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(`${tr.title} ${url}`)}">${esc(t.shareWhatsapp)}</a><a rel="noopener noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">${esc(t.shareFacebook)}</a></div>`;
  return `${crumbHtml(p)}<main id="content"><article class="blk wrap read"><div class="kicker dark">${esc(divisionOf(a.divisionKey)!.name[l])}</div><h1>${esc(tr.title)}</h1><p class="lead">${esc(tr.summary)}</p>
<div class="byline">${a.authorName ? `${esc(t.byAuthor)} ${esc(a.authorName)} · ` : ''}${esc(t.published)} ${fmtDate(a.publishedAt, l)}${a.updatedAt.getTime() - a.publishedAt.getTime() > 86400000 ? ` · ${esc(t.updated)} ${fmtDate(a.updatedAt, l)}` : ''} · ${tr.readingMinutes} ${esc(t.minRead)}</div>
${img}${toc}<div class="prose">${renderBody(tr.body)}</div>${faq}${share}${who}
${rel.length ? `<h2>${esc(t.relatedTitle)}</h2>${articleCards(rel, l)}` : ''}</article></main>`;
}

/** The chapters to show for a book in a language: only ones written in that language (a French page never shows English text). */
function chaptersOf(ctx: Ctx, key: string, lang: Lang): { title: string; summary: string | null }[] {
  const book = (ctx.books ?? []).find((b) => b.key === key);
  if (!book) return [];
  return book.chapters
    .map((c) => (lang === 'fr' ? { title: c.titleFr, summary: c.summaryFr } : { title: c.titleEn, summary: c.summaryEn }))
    .filter((c): c is { title: string; summary: string | null } => Boolean(c.title && c.title.trim()))
    .map((c) => ({ title: c.title.trim(), summary: c.summary && c.summary.trim() ? c.summary.trim() : null }));
}

function body(p: PageRef, ctx: Ctx): string {
  const t = UI[p.lang];
  const l = p.lang;
  const latest = articlesOf(ctx, l).slice(0, 6);
  switch (p.key) {
    case 'home': {
      const bookCard = bookShelf(l, true);
      return `<section class="hero"><div class="in${PHOTOS.founder ? ' has-photo' : ''}"><div class="copy"><div class="kicker">${esc(t.heroKicker)}</div><h1>${esc(t.heroTitle)}</h1><p>${esc(MISSION[l])}</p>
<a class="btn gold" href="${pathOf({ key: 'knowledge', lang: l })}">${esc(t.heroCta)}</a><a class="btn line" href="${pathOf({ key: 'about', lang: l })}">${esc(t.heroCta2)}</a></div>${PHOTOS.founder ? photo(PHOTOS.founder, l, { eager: true, caption: `<b>${esc(founderName(l))}</b><span>${esc(t.founderRole)}</span>` }) : ''}</div></section>
<section class="motto"><div class="wrap"><div class="kicker">${esc(t.mottoKicker)}</div><blockquote><p class="m1">${esc(MOTTO[l].lead)}</p><p class="m2">${esc(MOTTO[l].text)}</p></blockquote></div></section>
<main id="content"><section class="blk wrap"><div class="kicker dark">${esc(t.startHere)}</div><h2>${esc(t.areasTitle)}</h2><div class="grid two">${divisionCards(l)}</div></section>
${bookCard}
${latest.length ? `<section class="blk wrap"><h2>${esc(t.latestTitle)}</h2>${articleCards(latest.slice(0, 3), l)}</section>` : ''}
${PHOTOS.founderOffice ? `<section class="blk wrap founder">${photo(PHOTOS.founderOffice, l)}<div class="txt"><div class="kicker dark">${esc(t.founderKicker)}</div><h2>${esc(t.founderTitle)}</h2><p>${esc(t.founderText1)}</p><p>${esc(t.founderText2)}</p><a class="btn navy" href="${pathOf({ key: 'about', lang: l })}">${esc(t.founderCta)}</a></div></section>` : ''}
<section class="blk wrap"><h2>${esc(t.whatTitle)}</h2><ul class="ticks">${WHAT_WE_DO[l].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
${PHOTOS.group ? `<section class="blk wrap"><h2>${esc(t.togetherTitle)}</h2><div class="pair">${[PHOTOS.group, PHOTOS.groupClose, ...(PHOTOS.sessionMore ?? [])].filter((x): x is NonNullable<typeof x> => Boolean(x)).map((ph) => photo(ph, l, { caption: '' })).join('')}</div>${PHOTOS.group.caption ? `<p class="meta">${esc(PHOTOS.group.caption[l])}</p>` : ''}</section>` : ''}
<section class="blk wrap"><h2>${esc(t.ecoTitle)}</h2><div class="grid three steps"><div class="card"><i class="num" aria-hidden="true">1</i><b>${esc(t.ecoRead)}</b><span>${esc(t.ecoReadText)}</span></div><div class="card"><i class="num" aria-hidden="true">2</i><b>${esc(t.ecoLearn)}</b><span>${esc(t.ecoLearnText)}</span></div><div class="card"><i class="num" aria-hidden="true">3</i><b>${esc(t.ecoBelong)}</b><span>${esc(t.ecoBelongText)}</span></div></div></section></main>`;
    }
    case 'knowledge':
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap"><div class="kicker dark">${esc(t.navKnowledge)}</div><h1>${esc(t.kcTitle)}</h1><p class="lead read">${esc(t.kcIntro)}</p><div class="grid two" style="margin-top:22px">${divisionCards(l)}</div></section>
${latest.length ? `<section class="blk wrap"><h2>${esc(t.latestTitle)}</h2>${articleCards(latest, l)}</section>` : ''}</main>`;
    case 'division': {
      const d = p.division!;
      const list = articlesOf(ctx, l, d.key);
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap"><div class="kicker dark">${esc(t.kcTitle)}</div><h1>${esc(d.name[l])}</h1><p class="lead read">${esc(d.blurb[l])}</p>
<h2 style="margin-top:26px">${esc(t.divCovers)}</h2><ul class="list read">${d.topics[l].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
${d.key === 'books-publications' ? `</section>${bookShelf(l, false)}<section class="blk wrap">` : ''}
${list.length ? `<h2 style="margin-top:30px">${esc(t.articlesIn)}</h2>${articleCards(list, l)}` : d.hasArticles ? '' : `<div class="callout read">${esc(t.divSoon)}</div>`}<p><a href="${pathOf({ key: 'knowledge', lang: l })}">← ${esc(t.divBack)}</a></p></section></main>`;
    }
    case 'book': {
      const b = p.book!;
      const c = b.cover[l];
      const chapters = chaptersOf(ctx, b.key, l);
      const paras = (x: string) => x.split(/\n{2,}/).map((q) => `<p>${esc(q.trim())}</p>`).join('');
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap bookpage"><div class="bp"><img class="cover" src="${esc(c.src)}" width="${c.w}" height="${c.h}" alt="${esc(`${b.title[l]} — ${b.series[l]}`)}" decoding="async" fetchpriority="high"><div class="info"><div class="kicker dark">${esc(b.series[l])}</div><h1>${esc(b.title[l])}</h1><p class="lead">${esc(b.subtitle[l])}</p><p class="by">${esc(t.bookBy)} ${esc(founderName(l))}</p><p class="tag">${esc(b.tagline[l])}</p>${b.inSchool ? `<a class="btn gold" href="${joinHref(l, 'book-' + b.key)}">${esc(t.bookCta)}</a>` : ''}</div></div>
${chapters.length ? `<h2>${esc(t.bookChapters)}</h2><ol class="chap">${chapters.map((ch) => `<li><h3>${esc(ch.title)}</h3>${ch.summary ? paras(ch.summary) : ''}</li>`).join('')}</ol>` : ''}
${b.inSchool ? `<div class="callout read"><p>${esc(t.bookMembers)}</p></div>` : ''}
<p><a href="${pathOf({ key: 'division', lang: l, division: DIVISIONS.find((d) => d.key === 'books-publications')! })}">← ${esc(t.bookAll)}</a></p></section></main>`;
    }
    case 'about':
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap read"><h1>${esc(t.aboutTitle)}</h1>${PHOTOS.founderOffice ? `<div class="about-photo">${photo(PHOTOS.founderOffice, l, { caption: `<b>${esc(founderName(l))}</b><span>${esc(t.founderRole)}</span>` })}</div>` : ''}${aboutBody(l)}
<h2 style="margin-top:28px">${esc(t.aboutHow)}</h2><p>${esc(t.aboutHowText1)}</p><p>${esc(t.aboutHowText2)}</p><p>${esc(t.aboutHowText3)}</p>${PHOTOS.group ? photo(PHOTOS.group, l) : ''}</section></main>`;
    case 'contact':
      return `${crumbHtml(p)}<main id="content"><section class="blk wrap read"><h1>${esc(t.contactTitle)}</h1><p class="lead">${esc(t.contactIntro)}</p>
<div class="callout"><h3>${esc(t.contactForm)}</h3><p>${esc(t.contactFormText)}</p><a class="btn navy" href="/contact">${esc(t.contactForm)}</a></div>
<p><a href="/privacy">${esc(t.contactPrivacy)}</a></p></section></main>`;
    case 'article':
      return articleBody(p, ctx);
  }
}

export function renderPage(p: PageRef, ctx: Ctx = EMPTY_CTX): string {
  return `<!doctype html><html lang="${p.lang}"><head>${head(p, ctx)}</head><body>${header(p, ctx)}${body(p, ctx)}${joinBand(p)}${footer(p)}</body></html>`;
}

export function renderNotFound(lang: Lang): string {
  const t = UI[lang];
  const p: PageRef = { key: 'home', lang };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t.notFoundTitle)} — The God Nation</title><style>${CSS}</style></head><body>${header(p, EMPTY_CTX)}<main id="content"><section class="blk wrap read"><h1>${esc(t.notFoundTitle)}</h1><p class="lead">${esc(t.notFoundText)}</p><p><a class="btn navy" href="/${lang}/">${esc(t.notFoundHome)}</a></p></section></main>${footer(p)}</body></html>`;
}

/** Every page version that exists right now: the fixed pages plus each public article in each approved language. */
export function allPagesWith(ctx: Ctx): PageRef[] {
  const pages = allPages();
  for (const a of ctx.articles) for (const lang of LANGS) if (a.tr[lang] && divisionOf(a.divisionKey)) pages.push({ key: 'article', lang, article: a });
  return pages;
}

export function sitemapXml(ctx: Ctx = EMPTY_CTX): string {
  const items = allPagesWith(ctx).filter((r) => isIndexable(r, ctx));
  const urls = items.map((r) => {
    const cp = counterpart(r, ctx);
    const alts = [r, ...(cp ? [cp] : [])].map((x) => `<xhtml:link rel="alternate" hreflang="${x.lang}" href="${urlOf(x)}"/>`).join('');
    const last = r.key === 'article' ? `<lastmod>${r.article!.updatedAt.toISOString().slice(0, 10)}</lastmod>` : '';
    return `<url><loc>${urlOf(r)}</loc>${last}${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>`;
}
