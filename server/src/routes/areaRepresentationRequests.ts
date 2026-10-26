import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { profilePhotoPath } from '../lib/profilePhoto';
import { socialMutationLimiter } from '../lib/rateLimit';
import { titleForLevel, getAreaAncestors, formatAreaPath } from '../lib/geographicAreas';

// ---------------------------------------------------------------------------
// /api/member — browsing the Geographical Leadership Directory, and a
// Member's own "request to represent an area" (see
// AreaRepresentationRequest model comment in schema.prisma).
// ---------------------------------------------------------------------------

const router = Router();

// GET /api/member/geographic-areas/countries — every country with at least
// a NATIONAL root today (Cameroon initially; more appear automatically the
// moment Admin creates another country's root — no code change needed).
router.get('/geographic-areas/countries', requireMember, asyncHandler(async (_req, res) => {
  const roots = await prisma.geographicArea.findMany({ where: { level: 'NATIONAL' }, select: { id: true, name: true, country: true }, orderBy: { name: 'asc' } });
  res.json({ items: roots });
}));

// GET /api/member/geographic-areas?parentId=&search= — read-only tree
// browsing/search, same two-mode shape as the Admin version, for
// navigating or filtering to a specific area (e.g. while submitting a
// request, or finding where to drill down in the directory).
const browseQuerySchema = z.object({
  parentId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

router.get('/geographic-areas', requireMember, asyncHandler(async (req, res) => {
  const q = browseQuerySchema.parse(req.query);

  if (q.search) {
    const matches = await prisma.geographicArea.findMany({
      where: { name: { contains: q.search, mode: 'insensitive' } },
      include: { leadershipAssignments: { where: { status: 'ACTIVE' }, include: { person: { select: { id: true, name: true } } } } },
      take: 20,
      orderBy: { name: 'asc' },
    });
    return res.json({ items: matches.map(toAreaSummary) });
  }

  const where = { parentId: q.parentId ?? null };
  const items = await prisma.geographicArea.findMany({
    where,
    include: {
      _count: { select: { children: true } },
      leadershipAssignments: { where: { status: 'ACTIVE' }, include: { person: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json({ items: items.map(toAreaSummary) });
}));

function toAreaSummary(a: {
  id: string;
  name: string;
  level: string;
  country: string;
  _count?: { children: number };
  leadershipAssignments: { person: { id: string; name: string } }[];
}) {
  return {
    id: a.id,
    name: a.name,
    level: a.level,
    country: a.country,
    title: titleForLevel(a.level as any),
    hasChildren: (a._count?.children ?? 0) > 0,
    leaders: a.leadershipAssignments.map((la) => ({ personId: la.person.id, name: la.person.name })),
  };
}

// GET /api/member/leadership-directory/areas?country=&level= — the visual,
// scrollable directory: every area in a country (optionally narrowed to
// one level), each with its own full path and current leader(s) or an
// explicit vacancy. Flattened in one query (country is denormalized onto
// every row precisely so this never needs a tree walk).
const directoryQuerySchema = z.object({
  country: z.string().trim().min(1).max(120),
  level: z.enum(['NATIONAL', 'REGION', 'DIVISION', 'SUBDIVISION', 'QUARTER']).optional(),
});

router.get('/leadership-directory/areas', requireMember, asyncHandler(async (req, res) => {
  const q = directoryQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'A country is required.' });

  const areas = await prisma.geographicArea.findMany({
    where: { country: q.data.country, ...(q.data.level ? { level: q.data.level } : {}) },
    include: { leadershipAssignments: { where: { status: 'ACTIVE' }, include: { person: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } } } },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
    take: 300,
  });

  const items = await Promise.all(
    areas.map(async (a) => {
      const ancestors = await getAreaAncestors(a.id);
      return {
        id: a.id,
        name: a.name,
        level: a.level,
        title: titleForLevel(a.level),
        path: formatAreaPath(a, ancestors),
        leaders: a.leadershipAssignments.map((la) => ({
          personId: la.person.id,
          name: la.person.name,
          photoUrl: profilePhotoPath(la.person),
          // The position the admin named for this person, else the usual title for the level.
          title: la.title || titleForLevel(a.level),
        })),
      };
    }),
  );
  res.json({ items });
}));

// GET /api/member/leadership-directory/national-team — the people shown at
// the top of the directory, each with the title the admin gave them.
router.get('/leadership-directory/national-team', requireMember, asyncHandler(async (_req, res) => {
  const rows = await prisma.nationalTeamMember.findMany({
    include: { person: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({
    items: rows.map((r) => ({ personId: r.person.id, name: r.person.name, photoUrl: profilePhotoPath(r.person), title: r.title })),
  });
}));

// Either a place from the list (areaId), or — when the member's place is not
// listed — the place typed in. At least the region is needed in that case.
const typedPlace = z.string().trim().max(120).optional();
const createSchema = z
  .object({
    areaId: z.string().min(1).optional(),
    typedCountry: typedPlace,
    typedRegion: typedPlace,
    typedDivision: typedPlace,
    typedSubdivision: typedPlace,
    typedQuarter: typedPlace,
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => Boolean(v.areaId) !== Boolean(v.typedRegion), { message: 'Choose your place from the list, or type your region.' });

// GET /api/member/area-representation-requests/mine — the signed-in
// member's own request history, newest first.
router.get('/area-representation-requests/mine', requireMember, asyncHandler(async (req, res) => {
  const items = await prisma.areaRepresentationRequest.findMany({
    where: { personId: req.member!.personId },
    include: { area: { select: { id: true, name: true, level: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
}));

// POST /api/member/area-representation-requests — submit a new request to
// represent a real GeographicArea. Only one PENDING request per person at
// a time (same rule as RepresentationRequest), and submitting this never
// grants anything by itself — only Admin's approval does (see
// adminAreaRepresentationRequests.ts).
router.post('/area-representation-requests', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });

  if (parsed.data.areaId) {
    const area = await prisma.geographicArea.findUnique({ where: { id: parsed.data.areaId } });
    if (!area) return res.status(400).json({ error: 'Area not found.' });
  }

  const me = req.member!.personId;
  const existingPending = await prisma.areaRepresentationRequest.findFirst({ where: { personId: me, status: 'PENDING' } });
  if (existingPending) return res.status(409).json({ error: 'You already have a pending request.' });

  const created = await prisma.areaRepresentationRequest.create({
    data: {
      personId: me,
      areaId: parsed.data.areaId ?? null,
      typedCountry: parsed.data.areaId ? null : parsed.data.typedCountry || null,
      typedRegion: parsed.data.areaId ? null : parsed.data.typedRegion || null,
      typedDivision: parsed.data.areaId ? null : parsed.data.typedDivision || null,
      typedSubdivision: parsed.data.areaId ? null : parsed.data.typedSubdivision || null,
      typedQuarter: parsed.data.areaId ? null : parsed.data.typedQuarter || null,
      note: parsed.data.note || null,
    },
  });
  res.status(201).json(created);
}));

// DELETE /api/member/area-representation-requests/:id — withdraw while
// still pending.
router.delete('/area-representation-requests/:id', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const result = await prisma.areaRepresentationRequest.deleteMany({
    where: { id: req.params.id, personId: req.member!.personId, status: 'PENDING' },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

export default router;
