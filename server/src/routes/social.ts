import { isCentralAdminPerson } from '../lib/centralAdmin';
import { MAX_MESSAGE_CHARS } from '../lib/textLimits';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';
import { profilePhotoPath, coverPhotoPath } from '../lib/profilePhoto';
import { titleForLevel, getAreaAncestors, formatAreaPath } from '../lib/geographicAreas';
import { notifyPrivateMessageReceived } from '../lib/notifications';
import { getOrCreatePrivateConversation } from '../lib/privateMessaging';
import { friendRequestLimiter, socialMutationLimiter, memberReportLimiter, peopleSearchLimiter, messageSendLimiter } from '../lib/rateLimit';
import {
  canMessage,
  findFriendship,
  friendStatusBetween,
  getBlockedIds,
  getFollowerCount,
  getFollowingCount,
  getFriendBreakdown,
  getFriendIds,
  isBlockedEitherWay,
  isFollowing,
  nearness,
  publicAreaLabel,
  shareActiveGroup,
  type FriendStatus,
} from '../lib/social';
import { parsePagination, paginatedResult } from '../lib/pagination';

// ---------------------------------------------------------------------------
// /api/member — friends, people search, blocking, reports, and starting a
// private message with another member (Option B rules, see lib/social.ts).
// Every route acts as the signed-in member; ids in the body only ever name
// the OTHER person.
// ---------------------------------------------------------------------------

const router = Router();

const personSelect = {
  id: true,
  name: true,
  photoStorageKey: true,
  photoUpdatedAt: true,
  coverStorageKey: true,
  coverUpdatedAt: true,
  bio: true,
  locationCountry: true,
  locationRegion: true,
  locationDivision: true,
  locationSubdivision: true,
  locationQuarter: true,
  locationCity: true,
} satisfies Prisma.PersonSelect;

type PersonRow = Prisma.PersonGetPayload<{ select: typeof personSelect }>;

/** Only people who actually use the app (have a member account). */
// People who use the app — not someone whose account is waiting to be
// deleted (hidden for that month, see lib/accountDeletion.ts).
const APP_MEMBER: Prisma.PersonWhereInput = { memberAccount: { isNot: null }, deletionRequestedAt: null };

const personIdSchema = z.object({ personId: z.string().uuid() });

async function relationshipMaps(viewerId: string) {
  const [friendships, myBlocks, blockedIds] = await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [{ requesterPersonId: viewerId }, { addresseePersonId: viewerId }] },
    }),
    prisma.personBlock.findMany({ where: { blockerPersonId: viewerId }, select: { blockedPersonId: true } }),
    getBlockedIds(viewerId),
  ]);
  const status = new Map<string, { status: FriendStatus; requestId: string }>();
  for (const f of friendships) {
    const other = f.requesterPersonId === viewerId ? f.addresseePersonId : f.requesterPersonId;
    status.set(other, {
      status: f.status === 'ACCEPTED' ? 'FRIENDS' : f.requesterPersonId === viewerId ? 'REQUEST_SENT' : 'REQUEST_RECEIVED',
      requestId: f.id,
    });
  }
  for (const b of myBlocks) status.set(b.blockedPersonId, { status: 'BLOCKED', requestId: '' });
  return { status, hidden: new Set(blockedIds) };
}

function toCard(p: PersonRow, rel: Awaited<ReturnType<typeof relationshipMaps>>, extra: Record<string, unknown> = {}) {
  const r = rel.status.get(p.id);
  return {
    personId: p.id,
    name: p.name,
    photoUrl: profilePhotoPath(p),
    area: publicAreaLabel(p),
    friendStatus: (r?.status ?? 'NONE') as FriendStatus,
    requestId: r?.requestId || null,
    ...extra,
  };
}

// ----------------------------- People --------------------------------------

const searchSchema = z.object({ search: z.string().trim().min(2).max(100) });

router.get('/people', peopleSearchLimiter, requireMember, asyncHandler(async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Type at least 2 letters.' });
  const me = req.member!.personId;
  const rel = await relationshipMaps(me);
  const people = await prisma.person.findMany({
    where: {
      ...APP_MEMBER,
      id: { notIn: [me, ...rel.hidden] },
      name: { contains: parsed.data.search, mode: 'insensitive' },
    },
    select: personSelect,
    orderBy: { name: 'asc' },
    take: 30,
  });
  res.json({ items: people.map((p) => toCard(p, rel)) });
}));

// People who live near the member, closest first (same quarter, then
// subdivision, division, region — or the same city abroad).
router.get('/people/near', peopleSearchLimiter, requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const mine = await prisma.person.findUnique({ where: { id: me }, select: personSelect });
  if (!mine?.locationCountry) return res.json({ items: [] });
  const rel = await relationshipMaps(me);
  const candidates = await prisma.person.findMany({
    where: {
      ...APP_MEMBER,
      id: { notIn: [me, ...rel.hidden] },
      locationCountry: { equals: mine.locationCountry, mode: 'insensitive' },
      ...(mine.locationRegion ? { locationRegion: { equals: mine.locationRegion, mode: 'insensitive' } } : {}),
    },
    select: personSelect,
    take: 500,
  });
  const ranked = candidates
    .map((p) => ({ p, score: nearness(mine, p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, 30);
  res.json({ items: ranked.map((x) => toCard(x.p, rel, { nearness: x.score })) });
}));

// Friends of friends the member isn't connected with yet.
router.get('/people/suggested', peopleSearchLimiter, requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const rel = await relationshipMaps(me);
  const myFriends = await getFriendIds(me);
  if (myFriends.length === 0) return res.json({ items: [] });

  const theirs = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterPersonId: { in: myFriends } }, { addresseePersonId: { in: myFriends } }],
    },
    select: { requesterPersonId: true, addresseePersonId: true },
  });
  const exclude = new Set([me, ...myFriends, ...rel.hidden, ...rel.status.keys()]);
  const mutual = new Map<string, number>();
  const friendSet = new Set(myFriends);
  for (const f of theirs) {
    for (const [a, b] of [
      [f.requesterPersonId, f.addresseePersonId],
      [f.addresseePersonId, f.requesterPersonId],
    ]) {
      if (friendSet.has(a) && !exclude.has(b)) mutual.set(b, (mutual.get(b) ?? 0) + 1);
    }
  }
  const topIds = Array.from(mutual.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
  const people = await prisma.person.findMany({ where: { id: { in: topIds }, ...APP_MEMBER }, select: personSelect });
  const byId = new Map(people.map((p) => [p.id, p]));
  res.json({
    items: topIds.filter((id) => byId.has(id)).map((id) => toCard(byId.get(id)!, rel, { mutualFriends: mutual.get(id) })),
  });
}));

// GET /api/member/people/with-photo — the Home page member slider. Deliberately
// minimal (id/name/photo only, no friend-status lookups) since this loads on
// every Home page view and must stay light on slow connections; opening a
// card still goes through GET /people/:personId for the full profile.
router.get('/people/with-photo', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const blockedIds = await getBlockedIds(me);
  const people = await prisma.person.findMany({
    where: {
      ...APP_MEMBER,
      id: { notIn: [me, ...blockedIds] },
      photoStorageKey: { not: null },
    },
    select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true },
    orderBy: { photoUpdatedAt: 'desc' },
    take: 30,
  });
  res.json({
    items: people.map((p) => ({ personId: p.id, name: p.name, photoUrl: profilePhotoPath(p) })),
  });
}));

// One person's profile card, as seen by the signed-in member.
router.get('/people/:personId', requireMember, asyncHandler(async (req, res) => {
  const parsed = personIdSchema.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: 'Not found.' });
  const me = req.member!.personId;
  const other = parsed.data.personId;

  // Someone who blocked the viewer looks like they don't exist.
  const blockedMe = await prisma.personBlock.findFirst({ where: { blockerPersonId: other, blockedPersonId: me }, select: { id: true } });
  const person = blockedMe ? null : await prisma.person.findFirst({ where: { id: other, ...APP_MEMBER }, select: personSelect });
  if (!person) return res.status(404).json({ error: 'Not found.' });

  const [rel, friendBreakdown, messageAllowed, sameGroup, leaderOf, memberOf, areaAssignments, followerCount, followingCount, viewerFollows] = await Promise.all([
    friendStatusBetween(me, other),
    getFriendBreakdown(other),
    canMessage(me, other),
    shareActiveGroup(me, other),
    prisma.roleAssignment
      .findMany({ where: { personId: other, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, include: { community: { select: { name: true } } } })
      .then((rows) => rows.map((r) => r.community?.name).filter((name): name is string => Boolean(name))),
    prisma.communityMembership
      .findMany({ where: { personId: other, status: 'ACTIVE' }, include: { community: { select: { name: true } } } })
      .then((rows) => rows.map((r) => r.community.name)),
    prisma.areaLeadershipAssignment.findMany({ where: { personId: other, status: 'ACTIVE' }, include: { area: true } }),
    getFollowerCount(other),
    getFollowingCount(other),
    isFollowing(me, other),
  ]);

  // Geographical Leadership Directory — "Divisional Leader of Wouri
  // Division, Littoral, Cameroon," one entry per ACTIVE AreaLeadershipAssignment.
  const areaLeaderOf = await Promise.all(
    areaAssignments.map(async (a) => {
      const ancestors = await getAreaAncestors(a.area.id);
      return { title: titleForLevel(a.area.level), path: formatAreaPath(a.area, ancestors) };
    }),
  );

  res.json({
    personId: person.id,
    name: person.name,
    photoUrl: profilePhotoPath(person),
    coverUrl: coverPhotoPath(person),
    bio: person.bio,
    area: publicAreaLabel(person),
    badge: (await isCentralAdminPerson(person.id)) ? 'NATIONAL_COORDINATOR' : null,
    isLeader: leaderOf.length > 0,
    leaderOf,
    memberOf,
    areaLeaderOf,
    sameGroup,
    friendStatus: rel.status,
    requestId: rel.requestId,
    // Section 3: two community-visible buckets, each with its own count —
    // "Referred" (joined through this Person's own code) and "Community"
    // (ordinary friend-request-based friendships). friendCount stays as
    // their sum, for anything still reading the old single total.
    referredCount: friendBreakdown.referredIds.length,
    communityCount: friendBreakdown.communityIds.length,
    friendCount: friendBreakdown.referredIds.length + friendBreakdown.communityIds.length,
    followerCount,
    followingCount,
    isFollowing: viewerFollows,
    canMessage: messageAllowed,
  });
}));

// GET /api/member/people/:personId/referred — Section 3/32: paginated list
// of everyone who joined through this Person's own referral code (Leader-
// attribution and Member-code auto-friends combined into one bucket).
// Public to any signed-in member, same visibility as the profile card
// itself — the community is meant to see one another's referral success.
router.get('/people/:personId/referred', requireMember, asyncHandler(async (req, res) => {
  const parsed = personIdSchema.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: 'Not found.' });
  const other = parsed.data.personId;
  const person = await prisma.person.findFirst({ where: { id: other, ...APP_MEMBER }, select: { id: true } });
  if (!person) return res.status(404).json({ error: 'Not found.' });

  const me = req.member!.personId;
  const rel = await relationshipMaps(me);
  const { referredIds } = await getFriendBreakdown(other);
  const { page, pageSize, skip, take } = parsePagination(req);
  const pageIds = referredIds.slice(skip, skip + take);
  const people = await prisma.person.findMany({ where: { id: { in: pageIds }, deletionRequestedAt: null }, select: personSelect });
  const byId = new Map(people.map((p) => [p.id, p]));
  const items = pageIds.filter((id) => byId.has(id)).map((id) => toCard(byId.get(id)!, rel));
  res.json(paginatedResult(items, referredIds.length, page, pageSize));
}));

// GET /api/member/people/:personId/community — the rest of this Person's
// friends: ordinary friend-request-based friendships (see
// getFriendBreakdown's own comment for the exact, deliberately asymmetric
// split rule).
router.get('/people/:personId/community', requireMember, asyncHandler(async (req, res) => {
  const parsed = personIdSchema.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: 'Not found.' });
  const other = parsed.data.personId;
  const person = await prisma.person.findFirst({ where: { id: other, ...APP_MEMBER }, select: { id: true } });
  if (!person) return res.status(404).json({ error: 'Not found.' });

  const me = req.member!.personId;
  const rel = await relationshipMaps(me);
  const { communityIds } = await getFriendBreakdown(other);
  const { page, pageSize, skip, take } = parsePagination(req);
  const pageIds = communityIds.slice(skip, skip + take);
  const people = await prisma.person.findMany({ where: { id: { in: pageIds }, deletionRequestedAt: null }, select: personSelect });
  const byId = new Map(people.map((p) => [p.id, p]));
  const items = pageIds.filter((id) => byId.has(id)).map((id) => toCard(byId.get(id)!, rel));
  res.json(paginatedResult(items, communityIds.length, page, pageSize));
}));

// ----------------------------- Follows -------------------------------------

router.post('/follows', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = personIdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const me = req.member!.personId;
  const other = parsed.data.personId;
  if (other === me) return res.status(400).json({ error: 'You cannot follow yourself.' });

  const target = await prisma.person.findFirst({ where: { id: other, ...APP_MEMBER }, select: { id: true } });
  if (!target || (await isBlockedEitherWay(me, other))) return res.status(404).json({ error: 'Not found.' });

  await prisma.follow.upsert({
    where: { followerPersonId_followingPersonId: { followerPersonId: me, followingPersonId: other } },
    create: { followerPersonId: me, followingPersonId: other },
    update: {},
  });
  res.status(201).json({ isFollowing: true });
}));

router.delete('/follows/:personId', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  await prisma.follow.deleteMany({
    where: { followerPersonId: req.member!.personId, followingPersonId: req.params.personId },
  });
  res.json({ isFollowing: false });
}));

// ----------------------------- Friends -------------------------------------

router.get('/friends', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const ids = await getFriendIds(me);
  const rel = await relationshipMaps(me);
  const people = await prisma.person.findMany({ where: { id: { in: ids }, deletionRequestedAt: null }, select: personSelect, orderBy: { name: 'asc' } });
  res.json({ items: people.map((p) => toCard(p, rel)) });
}));

router.get('/friends/requests', requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const rows = await prisma.friendship.findMany({
    where: { status: 'PENDING', OR: [{ requesterPersonId: me }, { addresseePersonId: me }] },
    include: { requester: { select: personSelect }, addressee: { select: personSelect } },
    orderBy: { createdAt: 'desc' },
  });
  const rel = await relationshipMaps(me);
  res.json({
    incoming: rows.filter((r) => r.addresseePersonId === me).map((r) => toCard(r.requester, rel)),
    outgoing: rows.filter((r) => r.requesterPersonId === me).map((r) => toCard(r.addressee, rel)),
  });
}));

router.post('/friends/requests', friendRequestLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = personIdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const me = req.member!.personId;
  const other = parsed.data.personId;
  if (other === me) return res.status(400).json({ error: 'You cannot add yourself.' });

  const target = await prisma.person.findFirst({ where: { id: other, ...APP_MEMBER }, select: { id: true, friendRequestPolicy: true } });
  // Blocked either way: answer as if the person doesn't exist.
  if (!target || (await isBlockedEitherWay(me, other))) return res.status(404).json({ error: 'Not found.' });

  const existing = await findFriendship(me, other);
  if (existing?.status === 'ACCEPTED') return res.json({ friendStatus: 'FRIENDS', requestId: existing.id });
  if (existing && existing.requesterPersonId === me) return res.json({ friendStatus: 'REQUEST_SENT', requestId: existing.id });
  if (existing) {
    // They already asked me — sending a request back simply accepts it.
    const accepted = await prisma.friendship.update({ where: { id: existing.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    await notifyFriendAccepted(accepted.requesterPersonId, me, accepted.id);
    return res.json({ friendStatus: 'FRIENDS', requestId: accepted.id });
  }

  if (target.friendRequestPolicy === 'SAME_GROUP' && !(await shareActiveGroup(me, other))) {
    return res.status(403).json({ error: 'This person only accepts friend requests from their own group.', code: 'SAME_GROUP_ONLY' });
  }

  try {
    const created = await prisma.friendship.create({ data: { requesterPersonId: me, addresseePersonId: other } });
    const sender = await prisma.person.findUnique({ where: { id: me }, select: { name: true } });
    await prisma.notification.create({
      data: {
        recipientPersonId: other,
        type: 'FRIEND_REQUEST_RECEIVED',
        metadata: { senderName: sender?.name ?? '', personId: me },
        targetType: 'Friendship',
        targetId: created.id,
      },
    });
    res.status(201).json({ friendStatus: 'REQUEST_SENT', requestId: created.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.json({ friendStatus: 'REQUEST_SENT' });
    }
    throw err;
  }
}));

async function notifyFriendAccepted(requesterId: string, accepterId: string, friendshipId: string) {
  const accepter = await prisma.person.findUnique({ where: { id: accepterId }, select: { name: true } });
  await prisma.notification.create({
    data: {
      recipientPersonId: requesterId,
      type: 'FRIEND_REQUEST_ACCEPTED',
      metadata: { senderName: accepter?.name ?? '', personId: accepterId },
      targetType: 'Friendship',
      targetId: friendshipId,
    },
  });
}

router.post('/friends/requests/:id/accept', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const request = await prisma.friendship.findUnique({ where: { id: req.params.id } });
  if (!request || request.addresseePersonId !== me || request.status !== 'PENDING') {
    return res.status(404).json({ error: 'Friend request not found.' });
  }
  await prisma.friendship.update({ where: { id: request.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
  await notifyFriendAccepted(request.requesterPersonId, me, request.id);
  res.json({ friendStatus: 'FRIENDS' });
}));

router.post('/friends/requests/:id/decline', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  const request = await prisma.friendship.findUnique({ where: { id: req.params.id } });
  if (!request || request.addresseePersonId !== me || request.status !== 'PENDING') {
    return res.status(404).json({ error: 'Friend request not found.' });
  }
  // Deleted (not kept as "declined") so the requester isn't told, and can
  // ask again later.
  await prisma.friendship.delete({ where: { id: request.id } });
  res.json({ friendStatus: 'NONE' });
}));

// DELETE /api/member/friends/:personId — unfriend, or cancel a request I sent.
router.delete('/friends/:personId', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const me = req.member!.personId;
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterPersonId: me, addresseePersonId: req.params.personId },
        { requesterPersonId: req.params.personId, addresseePersonId: me, status: 'ACCEPTED' },
      ],
    },
  });
  res.json({ friendStatus: 'NONE' });
}));

// ----------------------------- Blocking ------------------------------------

router.get('/blocks', requireMember, asyncHandler(async (req, res) => {
  const rows = await prisma.personBlock.findMany({
    where: { blockerPersonId: req.member!.personId },
    include: { blocked: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items: rows.map((r) => ({ personId: r.blocked.id, name: r.blocked.name, photoUrl: profilePhotoPath(r.blocked) })) });
}));

router.post('/blocks', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = personIdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const me = req.member!.personId;
  const other = parsed.data.personId;
  if (other === me) return res.status(400).json({ error: 'You cannot block yourself.' });
  const exists = await prisma.person.findUnique({ where: { id: other }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Not found.' });

  await prisma.$transaction([
    prisma.personBlock.upsert({
      where: { blockerPersonId_blockedPersonId: { blockerPersonId: me, blockedPersonId: other } },
      create: { blockerPersonId: me, blockedPersonId: other },
      update: {},
    }),
    // Blocking ends any friendship or pending request between the two.
    prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterPersonId: me, addresseePersonId: other },
          { requesterPersonId: other, addresseePersonId: me },
        ],
      },
    }),
    // ...and any follow in either direction.
    prisma.follow.deleteMany({
      where: {
        OR: [
          { followerPersonId: me, followingPersonId: other },
          { followerPersonId: other, followingPersonId: me },
        ],
      },
    }),
  ]);
  res.json({ friendStatus: 'BLOCKED' });
}));

router.delete('/blocks/:personId', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  await prisma.personBlock.deleteMany({ where: { blockerPersonId: req.member!.personId, blockedPersonId: req.params.personId } });
  res.json({ friendStatus: 'NONE' });
}));

// ----------------------------- Reports -------------------------------------

const reportSchema = z.object({
  personId: z.string().uuid(),
  targetType: z.enum(['PERSON', 'PRIVATE_MESSAGE', 'UPDATE_POST', 'UPDATE_COMMENT']).default('PERSON'),
  targetId: z.string().max(100).optional(),
  reason: z.string().trim().min(3).max(1000),
});

router.post('/reports', memberReportLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please say briefly what happened.' });
  const me = req.member!.personId;
  const d = parsed.data;
  if (d.personId === me) return res.status(400).json({ error: 'You cannot report yourself.' });
  const exists = await prisma.person.findUnique({ where: { id: d.personId }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Not found.' });

  const report = await prisma.memberReport.create({
    data: {
      reporterPersonId: me,
      reportedPersonId: d.personId,
      targetType: d.targetType,
      targetId: d.targetId ?? null,
      reason: d.reason,
    },
    select: { id: true },
  });
  await recordAudit({ action: 'MEMBER_REPORT_CREATED', targetType: 'MemberReport', targetId: report.id });
  res.status(201).json({ id: report.id });
}));

// ----------------------------- Settings ------------------------------------

router.get('/me/social-settings', requireMember, asyncHandler(async (req, res) => {
  const p = await prisma.person.findUnique({ where: { id: req.member!.personId }, select: { friendRequestPolicy: true } });
  res.json({ friendRequestPolicy: p?.friendRequestPolicy ?? 'EVERYONE' });
}));

const settingsSchema = z.object({ friendRequestPolicy: z.enum(['EVERYONE', 'SAME_GROUP']) });

router.patch('/me/social-settings', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid setting.' });
  await prisma.person.update({ where: { id: req.member!.personId }, data: { friendRequestPolicy: parsed.data.friendRequestPolicy } });
  res.json(parsed.data);
}));

// ----------------------------- Start a private message ---------------------

const startMessageSchema = z.object({
  personId: z.string().uuid(),
  body: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

// POST /api/member/messages/start — first message to another member.
// Allowed only for friends, people in the same group, and the member's
// own leaders (or a leader's own members), and never across a block.
// Reuses the existing private conversation between the two if there is one
// (whichever of them started it).
router.post('/messages/start', messageSendLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = startMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Write a message first.' });
  const me = req.member!.personId;
  const other = parsed.data.personId;

  if (!(await canMessage(me, other))) {
    return res.status(403).json({
      error: 'You can message your friends, people in your group and your leaders. Send a friend request first.',
      code: 'NOT_ALLOWED',
    });
  }

  const existing = await prisma.privateConversation.findFirst({
    where: {
      OR: [
        { memberPersonId: other, initiatorPersonId: me },
        { memberPersonId: me, initiatorPersonId: other },
      ],
    },
  });
  const conversation = existing ?? (await getOrCreatePrivateConversation(other, { type: 'PERSON', personId: me }));

  await prisma.privateMessage.create({
    data: { conversationId: conversation.id, senderPersonId: me, body: parsed.data.body },
  });
  await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: me });
  res.status(201).json({ conversationId: conversation.id });
}));

// POST /api/member/messages/open — opens (or creates, without a message)
// the private chat with another member, so the app can show the WhatsApp-
// style chat screen straight away. Same rules as /messages/start: friends,
// same group, own leaders — and never across a block. An existing chat
// between the two can always be reopened (unless blocked).
const openChatSchema = z.object({ personId: z.string().uuid() });

router.post('/messages/open', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = openChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const me = req.member!.personId;
  const other = parsed.data.personId;
  if (other === me) return res.status(400).json({ error: 'Invalid request.' });
  if (await isBlockedEitherWay(me, other)) {
    return res.status(403).json({ error: 'You cannot message this person.', code: 'NOT_ALLOWED' });
  }

  const existing = await prisma.privateConversation.findFirst({
    where: {
      OR: [
        { memberPersonId: other, initiatorPersonId: me },
        { memberPersonId: me, initiatorPersonId: other },
      ],
    },
  });
  if (existing) return res.json({ conversationId: existing.id });

  if (!(await canMessage(me, other))) {
    return res.status(403).json({
      error: 'You can message your friends, people in your group and your leaders. Send a friend request first.',
      code: 'NOT_ALLOWED',
    });
  }
  const conversation = await getOrCreatePrivateConversation(other, { type: 'PERSON', personId: me });
  res.json({ conversationId: conversation.id });
}));

export default router;
