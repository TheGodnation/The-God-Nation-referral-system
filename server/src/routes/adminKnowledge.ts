import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { attachmentUploadAuthorizeLimiter, leadershipMutationLimiter } from '../lib/rateLimit';
import { createUploadUrl, deleteObject, headObject, isStorageConfigured } from '../lib/storage';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { DIVISIONS, SECTION } from '../lib/publicSite/content';
import { readingMinutes, renderBody, slugOf } from '../lib/publicSite/text';
import { invalidatePublicSite } from '../lib/publicSite/router';

// The Knowledge Centre's editing tools (central admin only). Nothing here can reach the
// public site until a person has (1) reviewed a language version and (2) pressed Publish.
// Editing a reviewed version takes it back to "not reviewed" so changed words are always
// re-checked by a person. AI help (a later phase) will only ever write drafts here.
type Actor = { id: string; email: string };

const DIVISION_KEYS = DIVISIONS.map((d) => d.key);
const LANG = z.enum(['en', 'fr']);
const SLUG = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');
const IMAGE_URL = z.string().trim().max(500).regex(/^(https:\/\/[^\s"<>]+|\/[^\s"<>]*)$/, 'The picture address must start with https:// or /.');

const articleSchema = z.object({
  divisionKey: z.string().refine((k) => DIVISION_KEYS.includes(k), 'Unknown knowledge area.').optional(),
  authorId: z.string().uuid().nullable().optional(),
  featuredImageUrl: IMAGE_URL.nullable().or(z.literal('')).optional(),
  featuredImageAltEn: z.string().trim().max(300).nullable().optional(),
  featuredImageAltFr: z.string().trim().max(300).nullable().optional(),
  aiAssisted: z.boolean().optional(),
  sourceNote: z.string().trim().max(1000).nullable().optional(),
  relatedIds: z.array(z.string().uuid()).max(6).optional(),
});

const translationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(500),
  body: z.string().max(100_000),
  slug: SLUG.optional(),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  faq: z.array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(2000) })).max(12).nullable().optional(),
});

const authorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  bioEn: z.string().trim().max(600).nullable().optional(),
  bioFr: z.string().trim().max(600).nullable().optional(),
});


const MEDIA_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
// The browser shrinks pictures before sending (long side 1600 px, about 150 to 400 KB); this is a ceiling.
export const MEDIA_MAX_BYTES = 1_500_000;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const mediaKey = (id: string, mime: string) => `knowledge/${id}.${EXT[mime]}`;
export const mediaUrl = (id: string, mime: string) => `/media/k/${id}.${EXT[mime]}`;
const mediaShape = (m: { id: string; mimeType: string; byteSize: number; width: number; height: number; altEn: string | null; altFr: string | null; createdAt: Date }) => ({
  id: m.id, url: mediaUrl(m.id, m.mimeType), byteSize: m.byteSize, width: m.width, height: m.height, altEn: m.altEn, altFr: m.altFr, createdAt: m.createdAt,
});

const nul = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
const bad = (res: import('express').Response, msg: string, status = 400) => res.status(status).json({ error: msg });

// Allowed moves between stages. "Scheduled" arrives with the editorial dashboard.
const MOVES: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['DRAFT', 'PUBLISHED'],
  PUBLISHED: ['UNPUBLISHED'],
  UNPUBLISHED: ['DRAFT', 'PUBLISHED'],
  SCHEDULED: ['APPROVED'],
};

const articleSelect = {
  id: true, divisionKey: true, status: true, authorId: true, featuredImageUrl: true, featuredImageAltEn: true, featuredImageAltFr: true,
  publishedAt: true, aiAssisted: true, sourceNote: true, createdAt: true, updatedAt: true,
  translations: { select: { lang: true, slug: true, title: true, summary: true, body: true, seoTitle: true, seoDescription: true, readingMinutes: true, faq: true, reviewedAt: true, reviewedBy: true, updatedAt: true } },
  relatedTo: { select: { toId: true } },
} satisfies Prisma.KnowledgeArticleSelect;

/** Where a version lives on the public site (only reachable once published and reviewed). */
function publicPathOf(divisionKey: string, lang: 'en' | 'fr', slug: string): string | null {
  const d = DIVISIONS.find((x) => x.key === divisionKey);
  return d ? `/${lang}/${SECTION[lang].knowledge}/${d.slug[lang]}/${slug}/` : null;
}

function shape(a: Prisma.KnowledgeArticleGetPayload<{ select: typeof articleSelect }>) {
  const { relatedTo, ...rest } = a;
  return {
    ...rest,
    translations: rest.translations.map((t) => ({
      ...t,
      publicPath: publicPathOf(a.divisionKey, t.lang as 'en' | 'fr', t.slug),
      // Visible to the public right now: published, and a person has reviewed this version.
      isPublic: a.status === 'PUBLISHED' && Boolean(t.reviewedAt),
    })),
    relatedIds: relatedTo.map((r) => r.toId),
  };
}

function build(resolveActor: (req: Request) => Promise<Actor | null>) {
  const router = Router();

  // Every change needs the actor; reads are already limited to the central admin by the mount.
  const act = async (req: Request, res: import('express').Response): Promise<Actor | null> => {
    const actor = await resolveActor(req);
    if (!actor) res.status(403).json({ error: 'Forbidden.' });
    return actor;
  };
  const changed = () => invalidatePublicSite();

  router.get('/', asyncHandler(async (_req, res) => {
    const [articles, authors] = await Promise.all([
      prisma.knowledgeArticle.findMany({ orderBy: { updatedAt: 'desc' }, take: 300, select: articleSelect }),
      prisma.knowledgeAuthor.findMany({ orderBy: { name: 'asc' } }),
    ]);
    res.json({
      divisions: DIVISIONS.map((d) => ({ key: d.key, name: d.name, slug: d.slug })),
      authors,
      // The list leaves out the long text; open one article to read or edit it.
      articles: articles.map((a) => {
        const s = shape(a);
        return { ...s, translations: s.translations.map(({ body: _b, faq: _f, ...t }) => t) };
      }),
    });
  }));

  // How a piece of article text will look: the very same safe renderer the public pages use.
  router.post('/preview', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const p = z.object({ body: z.string().max(100_000) }).safeParse(req.body);
    if (!p.success) return bad(res, 'Send the text to preview.');
    res.json({ html: renderBody(p.data.body), readingMinutes: readingMinutes(p.data.body) });
  }));

  router.get('/articles/:id', asyncHandler(async (req, res) => {
    const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id }, select: articleSelect });
    if (!a) return bad(res, 'Article not found.', 404);
    res.json(shape(a));
  }));

  router.post('/articles', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = articleSchema.required({ divisionKey: true }).safeParse(req.body);
    if (!p.success) return bad(res, p.error.issues[0]?.message ?? 'Check the form.');
    const d = p.data;
    if (d.featuredImageUrl && !(d.featuredImageAltEn || d.featuredImageAltFr)) return bad(res, 'A picture needs a short description (alt text) for people who cannot see it.');
    const created = await prisma.knowledgeArticle.create({
      data: {
        divisionKey: d.divisionKey, authorId: d.authorId ?? null, featuredImageUrl: nul(d.featuredImageUrl) ?? null,
        featuredImageAltEn: nul(d.featuredImageAltEn) ?? null, featuredImageAltFr: nul(d.featuredImageAltFr) ?? null,
        aiAssisted: d.aiAssisted ?? false, sourceNote: nul(d.sourceNote) ?? null,
      },
      select: articleSelect,
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_ARTICLE_CREATED', targetType: 'KnowledgeArticle', targetId: created.id, metadata: { divisionKey: d.divisionKey } });
    res.status(201).json(shape(created));
  }));

  router.put('/articles/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = articleSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error.issues[0]?.message ?? 'Check the form.');
    const d = p.data;
    const cur = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id }, select: { id: true, featuredImageUrl: true, featuredImageAltEn: true, featuredImageAltFr: true } });
    if (!cur) return bad(res, 'Article not found.', 404);
    const url = d.featuredImageUrl === undefined ? cur.featuredImageUrl : nul(d.featuredImageUrl) ?? null;
    const altEn = d.featuredImageAltEn === undefined ? cur.featuredImageAltEn : nul(d.featuredImageAltEn) ?? null;
    const altFr = d.featuredImageAltFr === undefined ? cur.featuredImageAltFr : nul(d.featuredImageAltFr) ?? null;
    if (url && !(altEn || altFr)) return bad(res, 'A picture needs a short description (alt text) for people who cannot see it.');
    if (d.relatedIds?.includes(req.params.id)) return bad(res, 'An article cannot be related to itself.');
    if (d.authorId) {
      const au = await prisma.knowledgeAuthor.findUnique({ where: { id: d.authorId }, select: { id: true } });
      if (!au) return bad(res, 'Author not found.');
    }
    if (d.relatedIds?.length) {
      const n = await prisma.knowledgeArticle.count({ where: { id: { in: d.relatedIds } } });
      if (n !== new Set(d.relatedIds).size) return bad(res, 'A related article was not found.');
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (d.relatedIds) {
        await tx.knowledgeArticleLink.deleteMany({ where: { fromId: req.params.id } });
        if (d.relatedIds.length) await tx.knowledgeArticleLink.createMany({ data: [...new Set(d.relatedIds)].map((toId) => ({ fromId: req.params.id, toId })) });
      }
      return tx.knowledgeArticle.update({
        where: { id: req.params.id },
        data: {
          ...(d.divisionKey ? { divisionKey: d.divisionKey } : {}),
          ...(d.authorId !== undefined ? { authorId: d.authorId } : {}),
          featuredImageUrl: url, featuredImageAltEn: altEn, featuredImageAltFr: altFr,
          ...(d.aiAssisted !== undefined ? { aiAssisted: d.aiAssisted } : {}),
          ...(d.sourceNote !== undefined ? { sourceNote: nul(d.sourceNote) ?? null } : {}),
        },
        select: articleSelect,
      });
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_ARTICLE_UPDATED', targetType: 'KnowledgeArticle', targetId: updated.id, metadata: { fields: Object.keys(d) } });
    changed();
    res.json(shape(updated));
  }));

  // Write or change one language version. A changed version needs a person's review again.
  router.put('/articles/:id/translations/:lang', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const lang = LANG.safeParse(req.params.lang);
    if (!lang.success) return bad(res, 'Language must be en or fr.');
    const p = translationSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error.issues[0]?.message ?? 'Check the form.');
    const d = p.data;
    const art = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!art) return bad(res, 'Article not found.', 404);
    const prev = await prisma.knowledgeArticleTranslation.findUnique({ where: { articleId_lang: { articleId: art.id, lang: lang.data } }, select: { slug: true, reviewedAt: true } });
    const slug = d.slug ?? prev?.slug ?? slugOf(d.title);
    const clash = await prisma.knowledgeArticleTranslation.findFirst({ where: { lang: lang.data, slug, NOT: { articleId: art.id } }, select: { id: true } });
    if (clash) return bad(res, 'Another article already uses this web address ending. Change the title or the address.', 409);
    const data = {
      slug, title: d.title, summary: d.summary, body: d.body,
      seoTitle: nul(d.seoTitle) ?? null, seoDescription: nul(d.seoDescription) ?? null,
      readingMinutes: readingMinutes(d.body),
      faq: d.faq && d.faq.length ? (d.faq as Prisma.InputJsonValue) : Prisma.JsonNull,
      reviewedAt: null, reviewedBy: null,
    };
    const saved = await prisma.knowledgeArticleTranslation.upsert({
      where: { articleId_lang: { articleId: art.id, lang: lang.data } },
      create: { articleId: art.id, lang: lang.data, ...data },
      update: data,
      select: { lang: true, slug: true, title: true, readingMinutes: true, reviewedAt: true },
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_TRANSLATION_SAVED', targetType: 'KnowledgeArticle', targetId: art.id, metadata: { lang: lang.data, hadReview: Boolean(prev?.reviewedAt) } });
    await prisma.knowledgeArticle.update({ where: { id: art.id }, data: { updatedAt: new Date() } });
    changed();
    res.json({ ...saved, reviewReset: Boolean(prev?.reviewedAt) });
  }));

  // A person's review of one language version. Only reviewed versions can ever be public.
  router.post('/articles/:id/translations/:lang/review', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const lang = LANG.safeParse(req.params.lang);
    const body = z.object({ approved: z.boolean() }).safeParse(req.body);
    if (!lang.success || !body.success) return bad(res, 'Say which language, and whether it is approved.');
    const t = await prisma.knowledgeArticleTranslation.findUnique({ where: { articleId_lang: { articleId: req.params.id, lang: lang.data } }, select: { id: true } });
    if (!t) return bad(res, 'That language version has not been written yet.', 404);
    await prisma.knowledgeArticleTranslation.update({ where: { id: t.id }, data: body.data.approved ? { reviewedAt: new Date(), reviewedBy: actor.email } : { reviewedAt: null, reviewedBy: null } });
    await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: body.data.approved ? 'KNOWLEDGE_TRANSLATION_APPROVED' : 'KNOWLEDGE_TRANSLATION_UNAPPROVED', targetType: 'KnowledgeArticle', targetId: req.params.id, metadata: { lang: lang.data } });
    changed();
    res.json({ ok: true, approved: body.data.approved });
  }));

  // Move between stages. Publishing needs a person-reviewed version (and a description for any picture).
  router.post('/articles/:id/status', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = z.object({ to: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED']) }).safeParse(req.body);
    if (!p.success) return bad(res, 'Unknown stage.');
    const a = await prisma.knowledgeArticle.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, publishedAt: true, featuredImageUrl: true, featuredImageAltEn: true, featuredImageAltFr: true, translations: { select: { lang: true, reviewedAt: true } } },
    });
    if (!a) return bad(res, 'Article not found.', 404);
    if (!(MOVES[a.status] ?? []).includes(p.data.to)) return bad(res, `An article that is "${a.status}" cannot move to "${p.data.to}".`, 409);
    if (p.data.to === 'PUBLISHED') {
      const reviewed = a.translations.filter((t) => t.reviewedAt);
      if (!reviewed.length) return bad(res, 'Nobody has reviewed a language version yet. Review at least one before publishing.', 409);
      if (a.featuredImageUrl) {
        const missing = reviewed.filter((t) => !(t.lang === 'en' ? a.featuredImageAltEn : a.featuredImageAltFr));
        if (missing.length) return bad(res, `The picture needs a description in: ${missing.map((m) => m.lang).join(', ')}.`, 409);
      }
    }
    const updated = await prisma.knowledgeArticle.update({
      where: { id: a.id },
      data: { status: p.data.to, ...(p.data.to === 'PUBLISHED' ? { publishedAt: a.publishedAt ?? new Date() } : {}) },
      select: articleSelect,
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: `KNOWLEDGE_ARTICLE_${p.data.to}`, targetType: 'KnowledgeArticle', targetId: a.id, metadata: { from: a.status } });
    changed();
    res.json(shape(updated));
  }));

  router.delete('/articles/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const a = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!a) return bad(res, 'Article not found.', 404);
    if (a.status === 'PUBLISHED') return bad(res, 'Withdraw (unpublish) it first.', 409);
    await prisma.knowledgeArticle.delete({ where: { id: a.id } });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_ARTICLE_DELETED', targetType: 'KnowledgeArticle', targetId: a.id });
    changed();
    res.json({ ok: true });
  }));


  // ---- Pictures --------------------------------------------------------------------------------
  // The browser shrinks the picture, sends it straight to storage, then tells us it is there. The
  // public website serves it through the app at /media/k/<id>.<ext> (see publicSite/router.ts).
  router.post('/media/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = z.object({ mimeType: z.enum(MEDIA_MIMES), byteSize: z.number().int().min(1).max(MEDIA_MAX_BYTES) }).safeParse(req.body);
    if (!p.success) return bad(res, `Use a JPEG, PNG or WebP picture of at most ${Math.round(MEDIA_MAX_BYTES / 1000)} KB.`);
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Picture uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    const id = crypto.randomUUID();
    const { url, expiresAt } = await createUploadUrl({ storageKey: mediaKey(id, p.data.mimeType), mimeType: p.data.mimeType });
    res.json({ id, uploadUrl: url, expiresAt, publicUrl: mediaUrl(id, p.data.mimeType) });
  }));

  router.post('/media/:id/finalize', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = z.object({
      mimeType: z.enum(MEDIA_MIMES), width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000),
      altEn: z.string().trim().max(300).nullable().optional(), altFr: z.string().trim().max(300).nullable().optional(),
    }).safeParse(req.body);
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return bad(res, 'Check the picture details.');
    const existing = await prisma.knowledgeMedia.findUnique({ where: { storageKey: mediaKey(req.params.id, p.data.mimeType) } });
    if (existing) return res.json(mediaShape(existing));
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Picture uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
    const key = mediaKey(req.params.id, p.data.mimeType);
    const head = await headObject({ storageKey: key });
    if (!head) return bad(res, 'The picture did not arrive. Please try again.', 404);
    if (head.contentLength > MEDIA_MAX_BYTES || (head.contentType && head.contentType !== p.data.mimeType)) {
      await deleteObject({ storageKey: key }).catch(() => undefined);
      return bad(res, 'The picture is too big or is not the kind that was announced.');
    }
    const row = await prisma.knowledgeMedia.create({
      data: { id: req.params.id, storageKey: key, mimeType: p.data.mimeType, byteSize: head.contentLength, width: p.data.width, height: p.data.height, altEn: nul(p.data.altEn) ?? null, altFr: nul(p.data.altFr) ?? null, uploadedBy: actor.email },
    });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_MEDIA_ADDED', targetType: 'KnowledgeMedia', targetId: row.id, metadata: { bytes: row.byteSize } });
    res.status(201).json(mediaShape(row));
  }));

  router.get('/media', asyncHandler(async (_req, res) => {
    const [rows, articles] = await Promise.all([
      prisma.knowledgeMedia.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.knowledgeArticle.findMany({ where: { featuredImageUrl: { not: null } }, select: { featuredImageUrl: true } }),
    ]);
    const used = (m: { id: string; mimeType: string }) => articles.some((a) => a.featuredImageUrl === mediaUrl(m.id, m.mimeType));
    res.json({ items: rows.map((m) => ({ ...mediaShape(m), inUse: used(m) })) });
  }));

  router.put('/media/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = z.object({ altEn: z.string().trim().max(300).nullable().optional(), altFr: z.string().trim().max(300).nullable().optional() }).safeParse(req.body);
    if (!p.success) return bad(res, 'Check the descriptions.');
    const cur = await prisma.knowledgeMedia.findUnique({ where: { id: req.params.id } });
    if (!cur) return bad(res, 'Picture not found.', 404);
    const row = await prisma.knowledgeMedia.update({ where: { id: cur.id }, data: { ...(p.data.altEn !== undefined ? { altEn: nul(p.data.altEn) ?? null } : {}), ...(p.data.altFr !== undefined ? { altFr: nul(p.data.altFr) ?? null } : {}) } });
    res.json(mediaShape(row));
  }));

  router.delete('/media/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const cur = await prisma.knowledgeMedia.findUnique({ where: { id: req.params.id } });
    if (!cur) return bad(res, 'Picture not found.', 404);
    const inUse = await prisma.knowledgeArticle.count({ where: { featuredImageUrl: mediaUrl(cur.id, cur.mimeType) } });
    if (inUse > 0) return bad(res, 'An article still uses this picture. Choose another picture there first.', 409);
    await deleteObject({ storageKey: cur.storageKey }).catch(() => undefined);
    await prisma.knowledgeMedia.delete({ where: { id: cur.id } });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_MEDIA_DELETED', targetType: 'KnowledgeMedia', targetId: cur.id });
    res.json({ ok: true });
  }));

  // Authors
  router.post('/authors', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = authorSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error.issues[0]?.message ?? 'Check the form.');
    const a = await prisma.knowledgeAuthor.create({ data: { name: p.data.name, bioEn: nul(p.data.bioEn) ?? null, bioFr: nul(p.data.bioFr) ?? null } });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_AUTHOR_CREATED', targetType: 'KnowledgeAuthor', targetId: a.id });
    res.status(201).json(a);
  }));

  router.put('/authors/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const p = authorSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error.issues[0]?.message ?? 'Check the form.');
    const cur = await prisma.knowledgeAuthor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!cur) return bad(res, 'Author not found.', 404);
    const a = await prisma.knowledgeAuthor.update({ where: { id: cur.id }, data: { name: p.data.name, bioEn: nul(p.data.bioEn) ?? null, bioFr: nul(p.data.bioFr) ?? null } });
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_AUTHOR_UPDATED', targetType: 'KnowledgeAuthor', targetId: a.id });
    changed();
    res.json(a);
  }));

  router.delete('/authors/:id', leadershipMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
    const actor = await act(req, res); if (!actor) return;
    const cur = await prisma.knowledgeAuthor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!cur) return bad(res, 'Author not found.', 404);
    await prisma.knowledgeAuthor.delete({ where: { id: cur.id } }); // articles keep existing, without an author
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'KNOWLEDGE_AUTHOR_DELETED', targetType: 'KnowledgeAuthor', targetId: cur.id });
    changed();
    res.json({ ok: true });
  }));

  return router;
}

export const adminKnowledgeRoutes = (() => {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.use(build(async (req) => (req.user ? { id: req.user.id, email: req.user.email } : null)));
  return router;
})();

export const memberCentralKnowledgeRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      next();
    }),
  );
  router.use(
    build(async (req) => {
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true } });
      return user && user.role === 'ADMIN' && user.active ? { id: user.id, email: user.email } : null;
    }),
  );
  return router;
})();
