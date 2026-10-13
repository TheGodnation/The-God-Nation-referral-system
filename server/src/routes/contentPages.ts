import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

const listQuerySchema = z.object({
  type: z.enum(['PAGE', 'TEACHING', 'ANNOUNCEMENT']).optional(),
});

function publicShape(page: {
  slug: string;
  type: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  mediaUrl: string | null;
  order: number;
  publishedAt: Date | null;
}) {
  return {
    slug: page.slug,
    type: page.type,
    titleEn: page.titleEn,
    titleFr: page.titleFr,
    bodyEn: page.bodyEn,
    bodyFr: page.bodyFr,
    mediaUrl: page.mediaUrl,
    order: page.order,
    publishedAt: page.publishedAt,
  };
}

// GET /api/content-pages — public, unauthenticated, published-only list.
// Backs Teachings/Announcements listing pages; optionally filtered by type.
router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query.' });
  }
  const pages = await prisma.contentPage.findMany({
    where: { published: true, ...(parsed.data.type ? { type: parsed.data.type } : {}) },
    orderBy: [{ order: 'asc' }, { publishedAt: 'desc' }],
  });
  res.json({ items: pages.map(publicShape) });
}));

// GET /api/content-pages/:slug — public, unauthenticated. 404s for both a
// missing slug and an unpublished one, so an unpublished page's existence
// is never revealed to an unauthenticated visitor.
router.get('/:slug', asyncHandler(async (req, res) => {
  const page = await prisma.contentPage.findUnique({ where: { slug: req.params.slug } });
  if (!page || !page.published) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json(publicShape(page));
}));

export default router;
