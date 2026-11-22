import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { DIVISIONS, SECTION } from './publicSite/content';
import { readingMinutes, slugOf } from './publicSite/text';
import { invalidatePublicSite } from './publicSite/router';
import { excerpt } from './ogMeta';
import { shareByLink, sharedPhotos, publicItem, previewText, ShareError, type SharedKind } from './sharedPosts';
import { getObjectStream, isStorageConfigured, putObject } from './storage';
import { pageJpegInfo } from './photoCard';
import { mediaKey, mediaUrl } from '../routes/adminKnowledge';

// "Also publish on the website": the central admin turns one of their shared posts into a Knowledge Centre article, so it has an
// ordinary public web page (English and French) that search engines such as Google can list, with the "join" invitation.
// The article is published at once; the English words are the admin's own (marked reviewed), the French is made automatically
// and stays "not reviewed" until the admin reads it. Nothing is lost by not reviewing: the founder decided both are posted.
// The article remembers its post in sourceNote ("post:<kind>:<id>"), so publishing again updates the same article.

const sourceOf = (kind: SharedKind, id: string) => `post:${kind}:${id}`;
type Lang = 'en' | 'fr';

async function existingArticle(kind: SharedKind, id: string) {
  return prisma.knowledgeArticle.findFirst({
    where: { sourceNote: sourceOf(kind, id) },
    select: { id: true, status: true, divisionKey: true, featuredImageUrl: true, translations: { select: { lang: true, slug: true, title: true, summary: true, body: true, reviewedAt: true } } },
  });
}

function pathsOf(divisionKey: string, translations: { lang: string; slug: string }[]): Partial<Record<Lang, string>> {
  const d = DIVISIONS.find((x) => x.key === divisionKey);
  const out: Partial<Record<Lang, string>> = {};
  if (!d) return out;
  for (const t of translations) {
    const l = t.lang as Lang;
    out[l] = `/${l}/${SECTION[l].knowledge}/${d.slug[l]}/${t.slug}/`;
  }
  return out;
}

/** Where this post stands on the website: not there, or its article (status, the pages, and whether the French has been read). */
export async function websiteState(kind: SharedKind, id: string) {
  const a = await existingArticle(kind, id);
  const divisions = DIVISIONS.map((d) => ({ key: d.key, name: d.name }));
  if (!a) return { kind, id, published: false, divisions };
  return {
    kind,
    id,
    published: a.status === 'PUBLISHED',
    articleId: a.id,
    divisionKey: a.divisionKey,
    paths: pathsOf(a.divisionKey, a.translations),
    frenchReviewed: a.translations.find((t) => t.lang === 'fr')?.reviewedAt != null,
    hasFrench: a.translations.some((t) => t.lang === 'fr'),
    divisions,
  };
}

async function uniqueSlug(lang: Lang, title: string, articleId: string | null): Promise<string> {
  const base = slugOf(title);
  for (let i = 0; i < 6; i += 1) {
    const slug = i === 0 ? base : `${base.slice(0, 50)}-${crypto.randomBytes(2).toString('hex')}`;
    const clash = await prisma.knowledgeArticleTranslation.findFirst({ where: { lang, slug, ...(articleId ? { NOT: { articleId } } : {}) }, select: { id: true } });
    if (!clash) return slug;
  }
  return `${base.slice(0, 40)}-${crypto.randomBytes(4).toString('hex')}`;
}

/** The post's first picture, made website-sized and stored as a Knowledge Centre picture. Null when there is none or it cannot be made. */
async function pictureFor(kind: SharedKind, id: string, altEn: string, altFr: string, by: string): Promise<{ url: string } | null> {
  if (!isStorageConfigured()) return null;
  try {
    const first = (await sharedPhotos(kind, id))[0];
    if (!first) return null;
    const stream = await getObjectStream({ storageKey: first.storageKey });
    if (!stream) return null;
    const chunks: Buffer[] = [];
    for await (const c of stream.body as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const made = await pageJpegInfo(Buffer.concat(chunks));
    if (!made) return null;
    const mediaId = crypto.randomUUID();
    const key = mediaKey(mediaId, 'image/jpeg');
    await putObject({ storageKey: key, body: made.bytes, mimeType: 'image/jpeg' });
    await prisma.knowledgeMedia.create({ data: { id: mediaId, storageKey: key, mimeType: 'image/jpeg', byteSize: made.bytes.length, width: made.width, height: made.height, altEn, altFr, uploadedBy: by } });
    return { url: mediaUrl(mediaId, 'image/jpeg') };
  } catch {
    return null; // the article still goes out, without the picture
  }
}

/**
 * Publishes (or updates) the website article for a shared post. Sharing by link is opened too (it makes the French and is what the
 * link buttons use). French is added only when the post really has French words (not the English repeated).
 */
export async function publishToWebsite(kind: SharedKind, id: string, opts: { divisionKey: string; actorEmail: string }) {
  if (!DIVISIONS.some((d) => d.key === opts.divisionKey)) throw new ShareError('Choose where it belongs on the website.', 400, 'BAD_AREA');
  await shareByLink(kind, id);
  const item = await publicItem(kind, id);
  if (!item) throw new ShareError('Not found.', 404);

  const versions: { lang: Lang; title: string; summary: string; body: string }[] = [];
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const make = (lang: Lang) => {
    const title = cut(item.title[lang].replace(/[#*]/g, '').trim(), 200);
    const body = item.body[lang].trim();
    const summary = cut(excerpt(previewText(item.title[lang], item.body[lang]), 300) || title, 500);
    return { lang, title, summary, body: body || summary };
  };
  versions.push(make('en'));
  // A French version only when it is really different from the English (a missing translation would be English under a French address).
  const fr = make('fr');
  const en = versions[0];
  const frenchIsReal = fr.title !== en.title || fr.body !== en.body;
  if (frenchIsReal) versions.push(fr);

  const prev = await existingArticle(kind, id);
  const picture = prev?.featuredImageUrl ? null : await pictureFor(kind, id, en.title, fr.title, opts.actorEmail);
  const now = new Date();

  const articleId = await prisma.$transaction(async (tx) => {
    const article = prev
      ? await tx.knowledgeArticle.update({
          where: { id: prev.id },
          data: { divisionKey: opts.divisionKey, status: 'PUBLISHED', publishedAt: now, ...(picture ? { featuredImageUrl: picture.url, featuredImageAltEn: en.title, featuredImageAltFr: fr.title } : {}) },
          select: { id: true },
        })
      : await tx.knowledgeArticle.create({
          data: {
            divisionKey: opts.divisionKey, status: 'PUBLISHED', publishedAt: now, aiAssisted: frenchIsReal, sourceNote: sourceOf(kind, id),
            ...(picture ? { featuredImageUrl: picture.url, featuredImageAltEn: en.title, featuredImageAltFr: fr.title } : {}),
          },
          select: { id: true },
        });
    for (const v of versions) {
      const old = prev?.translations.find((t) => t.lang === v.lang);
      const same = old && old.title === v.title && old.body === v.body;
      // Unchanged words keep their review; changed words go back to "not reviewed". English is the admin's own writing.
      const reviewed = v.lang === 'en' ? { reviewedAt: now, reviewedBy: opts.actorEmail } : same ? {} : { reviewedAt: null, reviewedBy: null };
      const data = {
        title: v.title, summary: v.summary, body: v.body, seoTitle: null, seoDescription: cut(v.summary, 160),
        readingMinutes: readingMinutes(v.body), faq: Prisma.JsonNull, ...reviewed,
      };
      if (old) await tx.knowledgeArticleTranslation.update({ where: { articleId_lang: { articleId: article.id, lang: v.lang } }, data });
      else await tx.knowledgeArticleTranslation.create({ data: { articleId: article.id, lang: v.lang, slug: await uniqueSlug(v.lang, v.title, article.id), ...data } });
    }
    return article.id;
  });
  invalidatePublicSite();
  void articleId;
  return websiteState(kind, id);
}

/** Takes the article off the website (the English and French pages stop being public). The article is kept, so it can go back. */
export async function takeOffWebsite(kind: SharedKind, id: string) {
  const a = await existingArticle(kind, id);
  if (a && a.status === 'PUBLISHED') {
    await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { status: 'UNPUBLISHED' } });
    invalidatePublicSite();
  }
  return websiteState(kind, id);
}
