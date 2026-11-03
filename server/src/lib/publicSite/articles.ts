import type { PrismaClient } from '@prisma/client';
import type { Lang } from './content';
import type { Ctx, PublicArticle, PublicTr } from './render';

const MEDIA_URL = /^\/media\/k\/([0-9a-f-]{36})\.(jpg|png|webp)$/;

// Loads what the public may see from the database. The rule lives here and nowhere else:
//   * the article must be PUBLISHED (a person pressed Publish; not DRAFT, REVIEW, SCHEDULED or ARCHIVED), and
//   * a language version is included only when a person has reviewed it (reviewedAt is set).
// Only public fields are selected, so nothing private can reach a page by accident.

interface FaqItem { q: string; a: string }
function faqOf(v: unknown): FaqItem[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is FaqItem => !!x && typeof (x as FaqItem).q === 'string' && typeof (x as FaqItem).a === 'string' && (x as FaqItem).q.trim() !== '' && (x as FaqItem).a.trim() !== '');
  return out.length ? out : null;
}

export async function loadPublicContext(db: Pick<PrismaClient, 'knowledgeArticle' | 'knowledgeMedia'>): Promise<Ctx> {
  const rows = await db.knowledgeArticle.findMany({
    where: { status: 'PUBLISHED', publishedAt: { not: null, lte: new Date() }, translations: { some: { reviewedAt: { not: null } } } },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true, divisionKey: true, publishedAt: true, updatedAt: true,
      featuredImageUrl: true, featuredImageAltEn: true, featuredImageAltFr: true,
      author: { select: { name: true, bioEn: true, bioFr: true } },
      translations: {
        where: { reviewedAt: { not: null } },
        select: { lang: true, slug: true, title: true, summary: true, body: true, seoTitle: true, seoDescription: true, readingMinutes: true, faq: true },
      },
      relatedTo: { select: { toId: true } },
    },
  });
  // Sizes of the pictures we host, so the page can reserve their space (nothing jumps while loading).
  const ids = rows.map((r) => MEDIA_URL.exec(r.featuredImageUrl ?? '')?.[1]).filter((x): x is string => Boolean(x));
  const sizes = new Map<string, { w: number; h: number }>();
  if (ids.length) for (const m of await db.knowledgeMedia.findMany({ where: { id: { in: ids } }, select: { id: true, width: true, height: true } })) sizes.set(m.id, { w: m.width, h: m.height });
  const articles: PublicArticle[] = rows.map((r) => {
    const tr: Partial<Record<Lang, PublicTr>> = {};
    for (const t of r.translations) {
      tr[t.lang as Lang] = { slug: t.slug, title: t.title, summary: t.summary, body: t.body, seoTitle: t.seoTitle, seoDescription: t.seoDescription, readingMinutes: t.readingMinutes, faq: faqOf(t.faq) };
    }
    return {
      id: r.id,
      divisionKey: r.divisionKey,
      publishedAt: r.publishedAt!,
      // The page's "updated" date is the latest change to the article or any approved version.
      updatedAt: r.updatedAt,
      authorName: r.author?.name ?? null,
      authorBio: { en: r.author?.bioEn ?? null, fr: r.author?.bioFr ?? null },
      imageUrl: r.featuredImageUrl,
      imageSize: sizes.get(MEDIA_URL.exec(r.featuredImageUrl ?? '')?.[1] ?? ''),
      imageAlt: { en: r.featuredImageAltEn, fr: r.featuredImageAltFr },
      tr,
      relatedIds: r.relatedTo.map((x) => x.toId),
    };
  });
  return { articles };
}
