import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { profilePhotoPath } from '../lib/profilePhoto';
import { socialMutationLimiter } from '../lib/rateLimit';
import { titleForLevel, getAreaAncestors, formatAreaPath, findAreaPath } from '../lib/geographicAreas';
import { ALREADY_QUARTER_MESSAGE, SUBDIVISION_FULL_MESSAGE, SUBDIVISION_SEATS, positionTitle, representsAQuarter, seatsOf } from '../lib/areaSeats';

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
          // The position the admin named for this person, else "Second Subdivision Representative" / the level's title.
          title: positionTitle(a.level, la.seat, la.title),
          seat: la.seat,
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

// GET /api/member/leadership-directory/representatives — the wall of representatives: the people appointed
// to represent a place (and the National Team), each with their photo, position and place. The ones that
// represent the viewer's own place (their quarter, subdivision, division or region) come first, marked
// `inYourArea`, so a person meets the people near them.
router.get('/leadership-directory/representatives', requireMember, asyncHandler(async (req, res) => {
  const personSelect = { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } as const;
  const me = await prisma.person.findUnique({
    where: { id: req.member!.personId },
    select: { locationRegion: true, locationDivision: true, locationSubdivision: true, locationQuarter: true },
  });
  const assignments = await prisma.areaLeadershipAssignment.findMany({
    where: { status: 'ACTIVE' },
    include: { person: { select: personSelect }, area: { select: { id: true, name: true, level: true } } },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  const key = (n: string | null | undefined) => (n ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_']/g, ' ').replace(/\s+/g, ' ').trim();
  const mine: Record<string, string> = { REGION: key(me?.locationRegion), DIVISION: key(me?.locationDivision), SUBDIVISION: key(me?.locationSubdivision), QUARTER: key(me?.locationQuarter) };
  const rank: Record<string, number> = { QUARTER: 0, SUBDIVISION: 1, DIVISION: 2, REGION: 3, NATIONAL: 4 };
  const items = await Promise.all(
    assignments.map(async (a) => {
      const ancestors = await getAreaAncestors(a.area.id);
      return {
        personId: a.person.id,
        name: a.person.name,
        photoUrl: profilePhotoPath(a.person),
        title: positionTitle(a.area.level, a.seat, a.title),
        seat: a.seat,
        level: a.area.level,
        place: formatAreaPath(a.area, ancestors),
        inYourArea: Boolean(mine[a.area.level]) && key(a.area.name) === mine[a.area.level],
      };
    }),
  );
  items.sort((x, y) => Number(y.inYourArea) - Number(x.inYourArea) || (rank[x.level] ?? 9) - (rank[y.level] ?? 9) || (x.seat ?? 9) - (y.seat ?? 9) || x.name.localeCompare(y.name));
  const team = await prisma.nationalTeamMember.findMany({
    include: { person: { select: personSelect } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({
    inYourArea: items.filter((i) => i.inYourArea),
    elsewhere: items.filter((i) => !i.inYourArea),
    nationalTeam: team.map((m) => ({ personId: m.person.id, name: m.person.name, photoUrl: profilePhotoPath(m.person), title: m.title })),
  });
}));

// GET /api/member/leadership-directory/faces — a few faces for the "Our
// Leaders" card on the People page: the National Team first, then people
// appointed to represent a place (including those whose request was approved).
router.get('/leadership-directory/faces', requireMember, asyncHandler(async (_req, res) => {
  const personSelect = { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } as const;
  const [team, assignments] = await Promise.all([
    prisma.nationalTeamMember.findMany({ include: { person: { select: personSelect } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 20 }),
    prisma.areaLeadershipAssignment.findMany({ where: { status: 'ACTIVE' }, include: { person: { select: personSelect } }, orderBy: { createdAt: 'asc' }, take: 40 }),
  ]);
  const dedupe = (people: { id: string; name: string; photoStorageKey: string | null; photoUpdatedAt: Date | null }[]) => {
    const seen = new Set<string>();
    return people.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  };
  const teamPeople = dedupe(team.map((t) => t.person));
  const areaPeople = dedupe(assignments.map((a) => a.person)).filter((p) => !teamPeople.some((t) => t.id === p.id));
  // Both kinds of leaders are shown: the National Team first, but never so many of them that the
  // people appointed to a place (an approved request, say) are pushed out of sight.
  const MAX = 8;
  const RESERVED_FOR_PLACES = Math.min(areaPeople.length, 4);
  const shownTeam = teamPeople.slice(0, MAX - RESERVED_FOR_PLACES);
  const shownAreas = areaPeople.slice(0, MAX - shownTeam.length);
  const items = [...shownTeam, ...shownAreas].map((p) => ({ personId: p.id, name: p.name, photoUrl: profilePhotoPath(p) }));
  res.json({ items, total: teamPeople.length + areaPeople.length });
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
  .refine((v) => Boolean(v.areaId) !== Boolean(v.typedRegion), { message: 'Choose your place from the list, or type your region.' })
  // Members ask to represent a subdivision, or a quarter within one. Regions and divisions are appointed
  // by the central authority, so the exact subdivision (with its division) is always needed.
  .refine((v) => Boolean(v.areaId) || (Boolean(v.typedDivision) && Boolean(v.typedSubdivision)), {
    message: 'Write the exact subdivision where you live (with its division). You can also add a quarter within it.',
  });

const ONLY_SUBDIVISION_OR_QUARTER = 'You can ask to represent a subdivision or a quarter within it. Regions and divisions are appointed by the central authority.';

// GET /api/member/leadership-directory/subdivision-status?areaId= (or the typed country, region, division,
// subdivision) — how many of the five seats of this subdivision are taken. When all five are, a new person can
// only ask for a quarter within it.
const statusQuerySchema = z.object({
  areaId: z.string().min(1).optional(),
  country: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  division: z.string().trim().max(120).optional(),
  subdivision: z.string().trim().max(120).optional(),
});
router.get('/leadership-directory/subdivision-status', requireMember, asyncHandler(async (req, res) => {
  const q = statusQuerySchema.parse(req.query);
  let area: { id: string; level: string } | null = null;
  if (q.areaId) {
    area = await prisma.geographicArea.findUnique({ where: { id: q.areaId }, select: { id: true, level: true } });
  } else {
    const found = await findAreaPath({ country: q.country, region: q.region, division: q.division, subdivision: q.subdivision });
    area = found.complete ? found.area : null;
  }
  const empty = { represented: false, count: 0, seats: SUBDIVISION_SEATS, full: false, nextSeat: 1, representatives: [] as string[] };
  if (!area || area.level !== 'SUBDIVISION') return res.json(empty);
  const seats = await seatsOf(area.id);
  res.json({ represented: seats.count > 0, count: seats.count, seats: SUBDIVISION_SEATS, full: seats.full, nextSeat: seats.nextSeat, representatives: seats.names });
}));

// Whether this member already represents a quarter (the form tells them before they ask for a second one).
router.get('/leadership-directory/my-quarter', requireMember, asyncHandler(async (req, res) => {
  res.json({ representsQuarter: await representsAQuarter(req.member!.personId) });
}));

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

  const me = req.member!.personId;
  // What is being asked for: a seat in a subdivision, or one quarter.
  let asksQuarter = Boolean(parsed.data.typedQuarter);
  if (parsed.data.areaId) {
    const area = await prisma.geographicArea.findUnique({ where: { id: parsed.data.areaId } });
    if (!area) return res.status(400).json({ error: 'Area not found.' });
    if (area.level !== 'SUBDIVISION' && area.level !== 'QUARTER') return res.status(400).json({ error: ONLY_SUBDIVISION_OR_QUARTER });
    asksQuarter = area.level === 'QUARTER';
    if (area.level === 'SUBDIVISION' && (await seatsOf(area.id)).full) return res.status(409).json({ error: SUBDIVISION_FULL_MESSAGE, code: 'SUBDIVISION_FULL' });
  } else if (!parsed.data.typedQuarter) {
    // A typed subdivision that is already on the list with all five seats taken: only a quarter can be asked for.
    const found = await findAreaPath({ country: parsed.data.typedCountry, region: parsed.data.typedRegion, division: parsed.data.typedDivision, subdivision: parsed.data.typedSubdivision });
    if (found.complete && found.area?.level === 'SUBDIVISION' && (await seatsOf(found.area.id)).full) {
      return res.status(409).json({ error: SUBDIVISION_FULL_MESSAGE, code: 'SUBDIVISION_FULL' });
    }
  }
  // One person represents only one quarter.
  if (asksQuarter && (await representsAQuarter(me))) return res.status(409).json({ error: ALREADY_QUARTER_MESSAGE, code: 'ALREADY_QUARTER' });

  // One waiting request for a subdivision seat, and one for a quarter: a person can hold both kinds of position.
  const waiting = await prisma.areaRepresentationRequest.findMany({ where: { personId: me, status: 'PENDING' }, include: { area: { select: { level: true } } } });
  const sameKind = waiting.some((r) => (r.area ? r.area.level === 'QUARTER' : Boolean(r.typedQuarter)) === asksQuarter);
  if (sameKind) return res.status(409).json({ error: 'You already have a pending request.', code: 'PENDING_EXISTS' });

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
