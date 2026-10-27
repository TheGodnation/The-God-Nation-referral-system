import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { eventCheckInLimiter, socialMutationLimiter } from '../lib/rateLimit';
import { recordAudit } from '../lib/audit';
import { profilePhotoPath } from '../lib/profilePhoto';
import { notifyEventNew } from '../lib/notifications';
import {
  canManageEvents,
  canSeeEvents,
  checkInWindow,
  creatableCommunities,
  DEFAULT_EVENT_MS,
  isPresent,
  newCheckInCode,
  presenceMap,
  visibleCommunityIds,
} from '../lib/events';

// /api/events — an assembly's calendar and its attendance sheet. Leaders of
// the assembly (and the central admin) add events and see who was present;
// members see the events of their assemblies, say "I will come", and say
// "I'm here" with the event's code. An event may point to a recorded teaching:
// a member who finishes it counts as present "by replay".
const router = Router();
router.use(requireMember);

const text = (max: number) => z.string().trim().max(max);
const eventSchema = z.object({
  communityId: z.string().min(1),
  title: text(200).min(1, 'Please give the event a title.'),
  description: text(2000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  location: text(200).optional(),
  onlineUrl: text(500)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'The online link must start with http:// or https://')
    .optional(),
  replayTeachingId: z.string().min(1).nullable().optional(),
});

const personSelect = { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } as const;

/** An event the person may see, plus whether they may manage it. */
async function loadEvent(req: Request, res: Response) {
  const personId = req.member!.personId;
  const event = await prisma.assemblyEvent.findUnique({
    where: { id: req.params.id },
    include: { community: { select: { id: true, name: true } }, replayTeaching: { select: { id: true, title: true, mediaKind: true, communityId: true } } },
  });
  if (!event || !(await canSeeEvents(personId, event.communityId))) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  return { event, personId, canManage: await canManageEvents(personId, event.communityId) };
}

async function checkReplay(communityId: string, teachingId: string | null | undefined) {
  if (!teachingId) return true;
  const t = await prisma.teaching.findUnique({ where: { id: teachingId }, select: { communityId: true } });
  return Boolean(t && t.communityId === communityId);
}

type EventRow = Awaited<ReturnType<typeof prisma.assemblyEvent.findMany<{ include: { community: { select: { name: true } } } }>>>[number];

function item(e: EventRow, mine: { going: boolean; presence: 'LIVE' | 'REPLAY' | null }, goingCount: number) {
  return {
    id: e.id,
    communityId: e.communityId,
    communityName: e.community.name,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    location: e.location,
    onlineUrl: e.onlineUrl,
    cancelled: Boolean(e.cancelledAt),
    hasReplay: Boolean(e.replayTeachingId),
    going: mine.going,
    goingCount,
    presence: mine.presence,
  };
}

// GET /api/events — what is coming, what just happened, and where I may add events.
router.get('/', asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const now = new Date();
  const visible = await visibleCommunityIds(personId);
  const where = visible === 'ALL' ? {} : { communityId: { in: visible } };
  const [upcoming, past] = await Promise.all([
    prisma.assemblyEvent.findMany({ where: { ...where, endsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 60, include: { community: { select: { name: true } } } }),
    prisma.assemblyEvent.findMany({
      where: { ...where, endsAt: { lt: now, gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) } },
      orderBy: { startsAt: 'desc' },
      take: 40,
      include: { community: { select: { name: true } } },
    }),
  ]);
  const all = [...upcoming, ...past];
  const [rsvps, goingCounts, presence] = await Promise.all([
    prisma.eventRsvp.findMany({ where: { personId, eventId: { in: all.map((e) => e.id) } }, select: { eventId: true } }),
    prisma.eventRsvp.groupBy({ by: ['eventId'], where: { eventId: { in: all.map((e) => e.id) } }, _count: { _all: true } }),
    presenceMap(all, [personId]),
  ]);
  const going = new Set(rsvps.map((r) => r.eventId));
  const counts = new Map(goingCounts.map((g) => [g.eventId, g._count._all]));
  const shape = (e: EventRow) => {
    const c = presence.get(e.id)?.get(personId);
    return item(e, { going: going.has(e.id), presence: c?.live ? 'LIVE' : c?.replay ? 'REPLAY' : null }, counts.get(e.id) ?? 0);
  };
  res.json({ upcoming: upcoming.map(shape), past: past.map(shape), creatable: await creatableCommunities(personId) });
}));

// POST /api/events — a leader of the assembly, or the central admin.
router.post('/', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Please check the event details.' });
  const d = parsed.data;
  if (!(await canManageEvents(personId, d.communityId))) return res.status(403).json({ error: 'Only the leaders of this assembly can add events.', code: 'NOT_ALLOWED' });
  const community = await prisma.community.findUnique({ where: { id: d.communityId }, select: { id: true, name: true } });
  if (!community) return res.status(404).json({ error: 'Assembly not found.' });
  const endsAt = d.endsAt ?? new Date(d.startsAt.getTime() + DEFAULT_EVENT_MS);
  if (endsAt <= d.startsAt) return res.status(400).json({ error: 'The event must end after it starts.' });
  if (d.startsAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'Please choose a date within the next year.' });
  if (!(await checkReplay(d.communityId, d.replayTeachingId))) return res.status(400).json({ error: 'That teaching does not belong to this assembly.' });

  const event = await prisma.assemblyEvent.create({
    data: {
      communityId: d.communityId,
      title: d.title,
      description: d.description || null,
      startsAt: d.startsAt,
      endsAt,
      location: d.location || null,
      onlineUrl: d.onlineUrl || null,
      replayTeachingId: d.replayTeachingId ?? null,
      checkInCode: newCheckInCode(),
      createdByPersonId: personId,
    },
  });
  await recordAudit({ action: 'EVENT_CREATED', targetType: 'AssemblyEvent', targetId: event.id, metadata: { communityId: d.communityId } });
  const members = await prisma.communityMembership.findMany({ where: { communityId: d.communityId, status: 'ACTIVE', personId: { not: personId } }, select: { personId: true } });
  await notifyEventNew({ id: event.id, title: event.title, startsAt: event.startsAt, communityName: community.name }, members.map((m) => m.personId)).catch(() => {});
  res.status(201).json({ id: event.id });
}));

// GET /api/events/summary?communityId= — per member: present at how many of the last events.
router.get('/summary', asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const communityId = typeof req.query.communityId === 'string' ? req.query.communityId : '';
  if (!communityId || !(await canManageEvents(personId, communityId))) return res.status(403).json({ error: 'Only the leaders of this assembly can see this.', code: 'NOT_ALLOWED' });
  const last = Math.min(Math.max(parseInt(String(req.query.last ?? '10'), 10) || 10, 1), 30);
  const events = await prisma.assemblyEvent.findMany({
    where: { communityId, cancelledAt: null, startsAt: { lte: new Date() } },
    orderBy: { startsAt: 'desc' },
    take: last,
    select: { id: true, replayTeachingId: true, title: true, startsAt: true },
  });
  const members = await prisma.communityMembership.findMany({
    where: { communityId, status: 'ACTIVE' },
    select: { person: { select: personSelect } },
  });
  const presence = await presenceMap(events);
  const rows = members
    .map((m) => ({
      personId: m.person.id,
      name: m.person.name,
      photoUrl: profilePhotoPath(m.person),
      present: events.filter((e) => isPresent(presence.get(e.id)?.get(m.person.id))).length,
    }))
    .sort((a, b) => a.present - b.present || a.name.localeCompare(b.name));
  res.json({ total: events.length, items: rows });
}));

// GET /api/events/replay-options?communityId= — the teachings of this assembly a leader can attach as the replay.
router.get('/replay-options', asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const communityId = typeof req.query.communityId === 'string' ? req.query.communityId : '';
  if (!communityId || !(await canManageEvents(personId, communityId))) return res.status(403).json({ error: 'Not allowed.', code: 'NOT_ALLOWED' });
  const items = await prisma.teaching.findMany({ where: { communityId }, orderBy: { createdAt: 'desc' }, take: 40, select: { id: true, title: true, mediaKind: true, createdAt: true } });
  res.json({ items });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  const { event, personId, canManage } = found;
  const [mineRsvp, goingCount, presence, presentCount] = await Promise.all([
    prisma.eventRsvp.findUnique({ where: { eventId_personId: { eventId: event.id, personId } }, select: { id: true } }),
    prisma.eventRsvp.count({ where: { eventId: event.id } }),
    presenceMap([event], [personId]),
    canManage ? presentCountFor(event) : Promise.resolve(null),
  ]);
  const mine = presence.get(event.id)?.get(personId);
  const win = checkInWindow(event);
  res.json({
    id: event.id,
    communityId: event.communityId,
    communityName: event.community.name,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    onlineUrl: event.onlineUrl,
    cancelled: Boolean(event.cancelledAt),
    going: Boolean(mineRsvp),
    goingCount,
    window: win,
    mine: { live: mine?.live ?? null, replayDone: Boolean(mine?.replay) },
    replay: event.replayTeaching ? { teachingId: event.replayTeaching.id, title: event.replayTeaching.title, mediaKind: event.replayTeaching.mediaKind } : null,
    canManage,
    // Only the leaders see the code and the head count.
    ...(canManage ? { checkInCode: event.checkInCode, presentCount } : {}),
  });
}));

async function presentCountFor(event: { id: string; communityId: string; replayTeachingId: string | null }) {
  const members = await prisma.communityMembership.findMany({ where: { communityId: event.communityId, status: 'ACTIVE' }, select: { personId: true } });
  const presence = await presenceMap([event], members.map((m) => m.personId));
  return members.filter((m) => isPresent(presence.get(event.id)?.get(m.personId))).length;
}

const patchSchema = eventSchema.omit({ communityId: true }).partial();

router.patch('/:id', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  if (!found.canManage) return res.status(403).json({ error: 'Only the leaders of this assembly can change events.', code: 'NOT_ALLOWED' });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Please check the event details.' });
  const d = parsed.data;
  const { event } = found;
  const startsAt = d.startsAt ?? event.startsAt;
  const endsAt = d.endsAt ?? (d.startsAt && !d.endsAt ? new Date(d.startsAt.getTime() + (event.endsAt.getTime() - event.startsAt.getTime())) : event.endsAt);
  if (endsAt <= startsAt) return res.status(400).json({ error: 'The event must end after it starts.' });
  if (d.replayTeachingId !== undefined && !(await checkReplay(event.communityId, d.replayTeachingId))) return res.status(400).json({ error: 'That teaching does not belong to this assembly.' });
  await prisma.assemblyEvent.update({
    where: { id: event.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description || null } : {}),
      ...(d.location !== undefined ? { location: d.location || null } : {}),
      ...(d.onlineUrl !== undefined ? { onlineUrl: d.onlineUrl || null } : {}),
      ...(d.replayTeachingId !== undefined ? { replayTeachingId: d.replayTeachingId } : {}),
      startsAt,
      endsAt,
      // A moved event gets its reminder again.
      ...(d.startsAt ? { reminderSentAt: null } : {}),
    },
  });
  res.json({ ok: true });
}));

router.post('/:id/cancel', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  if (!found.canManage) return res.status(403).json({ error: 'Only the leaders of this assembly can cancel events.', code: 'NOT_ALLOWED' });
  await prisma.assemblyEvent.update({ where: { id: found.event.id }, data: { cancelledAt: new Date() } });
  await recordAudit({ action: 'EVENT_CANCELLED', targetType: 'AssemblyEvent', targetId: found.event.id });
  res.json({ ok: true });
}));

// "I will come" / "I will not come".
router.put('/:id/rsvp', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  if (found.event.cancelledAt) return res.status(409).json({ error: 'This event was cancelled.', code: 'CANCELLED' });
  if (found.event.endsAt < new Date()) return res.status(409).json({ error: 'This event is over.', code: 'OVER' });
  await prisma.eventRsvp.upsert({
    where: { eventId_personId: { eventId: found.event.id, personId: found.personId } },
    create: { eventId: found.event.id, personId: found.personId },
    update: {},
  });
  res.json({ going: true, goingCount: await prisma.eventRsvp.count({ where: { eventId: found.event.id } }) });
}));

router.delete('/:id/rsvp', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  await prisma.eventRsvp.deleteMany({ where: { eventId: found.event.id, personId: found.personId } });
  res.json({ going: false, goingCount: await prisma.eventRsvp.count({ where: { eventId: found.event.id } }) });
}));

// "I'm here": the code the leader gave, while the event is open.
router.post('/:id/check-in', eventCheckInLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  const { event, personId } = found;
  if (event.cancelledAt) return res.status(409).json({ error: 'This event was cancelled.', code: 'CANCELLED' });
  const win = checkInWindow(event);
  if (!win.open) {
    return res.status(409).json({
      error: Date.now() < win.opensAt.getTime() ? 'Saying "I\'m here" opens half an hour before the event.' : 'This event is over.',
      code: Date.now() < win.opensAt.getTime() ? 'NOT_OPEN_YET' : 'CLOSED',
      opensAt: win.opensAt,
    });
  }
  const parsed = z.object({ code: z.string().trim().regex(/^\d{4}$/) }).safeParse(req.body);
  if (!parsed.success || parsed.data.code !== event.checkInCode) return res.status(400).json({ error: 'That code is not right. Ask your leader for the code.', code: 'WRONG_CODE' });
  // Only the people of the assembly are counted (a leader who is not a member is, too, by being ticked).
  if (!(await prisma.communityMembership.findFirst({ where: { communityId: event.communityId, personId, status: 'ACTIVE' }, select: { id: true } }))) {
    return res.status(403).json({ error: 'Only members of this assembly can be counted.', code: 'NOT_MEMBER' });
  }
  await prisma.eventAttendance.upsert({
    where: { eventId_personId: { eventId: event.id, personId } },
    create: { eventId: event.id, personId, method: 'SELF' },
    update: {},
  });
  res.json({ present: true });
}));

// The attendance sheet.
router.get('/:id/attendance', asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  if (!found.canManage) return res.status(403).json({ error: 'Only the leaders of this assembly can see the attendance sheet.', code: 'NOT_ALLOWED' });
  const { event } = found;
  const members = await prisma.communityMembership.findMany({
    where: { communityId: event.communityId, status: 'ACTIVE' },
    select: { person: { select: personSelect } },
  });
  const ids = members.map((m) => m.person.id);
  const [presence, rsvps] = await Promise.all([presenceMap([event], ids), prisma.eventRsvp.findMany({ where: { eventId: event.id }, select: { personId: true } })]);
  const going = new Set(rsvps.map((r) => r.personId));
  const items = members
    .map((m) => {
      const c = presence.get(event.id)?.get(m.person.id);
      return {
        personId: m.person.id,
        name: m.person.name,
        photoUrl: profilePhotoPath(m.person),
        going: going.has(m.person.id),
        live: c?.live ?? null,
        replay: Boolean(c?.replay),
        present: isPresent(c),
      };
    })
    .sort((a, b) => Number(b.present) - Number(a.present) || Number(b.going) - Number(a.going) || a.name.localeCompare(b.name));
  res.json({
    totals: { members: items.length, going: items.filter((i) => i.going).length, present: items.filter((i) => i.present).length, live: items.filter((i) => i.live).length, replay: items.filter((i) => !i.live && i.replay).length },
    items,
  });
}));

// Tick or untick a person (the leader's own marking).
router.put('/:id/attendance/:personId', socialMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadEvent(req, res);
  if (!found) return;
  if (!found.canManage) return res.status(403).json({ error: 'Only the leaders of this assembly can mark attendance.', code: 'NOT_ALLOWED' });
  const parsed = z.object({ present: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Say whether the person was present.' });
  const { event } = found;
  const person = req.params.personId;
  if (!(await prisma.communityMembership.findFirst({ where: { communityId: event.communityId, personId: person, status: 'ACTIVE' }, select: { id: true } }))) {
    return res.status(404).json({ error: 'That person is not in this assembly.' });
  }
  if (parsed.data.present) {
    await prisma.eventAttendance.upsert({
      where: { eventId_personId: { eventId: event.id, personId: person } },
      create: { eventId: event.id, personId: person, method: 'LEADER', markedByPersonId: found.personId },
      update: {},
    });
  } else {
    await prisma.eventAttendance.deleteMany({ where: { eventId: event.id, personId: person } });
  }
  res.json({ present: parsed.data.present });
}));

export default router;
