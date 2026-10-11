import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Friends, blocking and the "who may message whom" rule (Option B):
// a member may privately message
//   - their friends,
//   - anyone in one of their own groups,
//   - the leaders of their groups (and a leader may message their members),
// never someone who has blocked them or whom they have blocked.
// Strangers from other groups must become friends first.
// ---------------------------------------------------------------------------

export type FriendStatus = 'SELF' | 'NONE' | 'FRIENDS' | 'REQUEST_SENT' | 'REQUEST_RECEIVED' | 'BLOCKED';

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const block = await prisma.personBlock.findFirst({
    where: {
      OR: [
        { blockerPersonId: a, blockedPersonId: b },
        { blockerPersonId: b, blockedPersonId: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(block);
}

/** The single friendship row between two people, whichever way it was asked. */
export async function findFriendship(a: string, b: string) {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterPersonId: a, addresseePersonId: b },
        { requesterPersonId: b, addresseePersonId: a },
      ],
    },
  });
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const f = await findFriendship(a, b);
  return f?.status === 'ACCEPTED';
}

export async function getFriendIds(personId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterPersonId: personId }, { addresseePersonId: personId }] },
    select: { requesterPersonId: true, addresseePersonId: true },
  });
  return rows.map((r) => (r.requesterPersonId === personId ? r.addresseePersonId : r.requesterPersonId));
}

/** Everyone `personId` has blocked or been blocked by. */
export async function getBlockedIds(personId: string): Promise<string[]> {
  const rows = await prisma.personBlock.findMany({
    where: { OR: [{ blockerPersonId: personId }, { blockedPersonId: personId }] },
    select: { blockerPersonId: true, blockedPersonId: true },
  });
  return rows.map((r) => (r.blockerPersonId === personId ? r.blockedPersonId : r.blockerPersonId));
}

export async function getActiveGroupIds(personId: string): Promise<string[]> {
  const rows = await prisma.communityMembership.findMany({
    where: { personId, status: 'ACTIVE' },
    select: { communityId: true },
  });
  return rows.map((r) => r.communityId);
}

export async function shareActiveGroup(a: string, b: string): Promise<boolean> {
  const groups = await getActiveGroupIds(a);
  if (groups.length === 0) return false;
  const shared = await prisma.communityMembership.findFirst({
    where: { personId: b, status: 'ACTIVE', communityId: { in: groups } },
    select: { id: true },
  });
  return Boolean(shared);
}

/** Whether `leaderId` has an ACTIVE leader role over a group `memberId` is in. */
export async function leadsGroupOf(leaderId: string, memberId: string): Promise<boolean> {
  const roles = await prisma.roleAssignment.findMany({
    where: { personId: leaderId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } },
    select: { communityId: true },
  });
  if (roles.length === 0) return false;
  const membership = await prisma.communityMembership.findFirst({
    where: { personId: memberId, status: 'ACTIVE', communityId: { in: roles.map((r) => r.communityId!) } },
    select: { id: true },
  });
  return Boolean(membership);
}

export async function canMessage(senderId: string, recipientId: string): Promise<boolean> {
  if (senderId === recipientId) return false;
  if (await isBlockedEitherWay(senderId, recipientId)) return false;
  if (await areFriends(senderId, recipientId)) return true;
  if (await shareActiveGroup(senderId, recipientId)) return true;
  if (await leadsGroupOf(recipientId, senderId)) return true;
  if (await leadsGroupOf(senderId, recipientId)) return true;
  return false;
}

export async function friendStatusBetween(viewerId: string, otherId: string): Promise<{ status: FriendStatus; requestId: string | null }> {
  if (viewerId === otherId) return { status: 'SELF', requestId: null };
  const block = await prisma.personBlock.findFirst({
    where: { blockerPersonId: viewerId, blockedPersonId: otherId },
    select: { id: true },
  });
  if (block) return { status: 'BLOCKED', requestId: null };
  const f = await findFriendship(viewerId, otherId);
  if (!f) return { status: 'NONE', requestId: null };
  if (f.status === 'ACCEPTED') return { status: 'FRIENDS', requestId: f.id };
  return { status: f.requesterPersonId === viewerId ? 'REQUEST_SENT' : 'REQUEST_RECEIVED', requestId: f.id };
}

/**
 * A short, safe description of where someone is: subdivision (or division),
 * region / city, country — never the quarter, so a member's neighbourhood
 * is never shown to other members.
 */
export function publicAreaLabel(p: {
  locationCountry: string | null;
  locationRegion: string | null;
  locationDivision: string | null;
  locationSubdivision: string | null;
  locationCity: string | null;
}): string | null {
  const parts = p.locationRegion
    ? [p.locationSubdivision ?? p.locationDivision, p.locationRegion]
    : [p.locationCity, p.locationCountry];
  const label = parts.filter(Boolean).join(', ');
  return label || null;
}

/**
 * How close two people live, from their sign-up location: 4 = same quarter,
 * 3 = same subdivision, 2 = same division, 1 = same region (or same city
 * abroad), 0 = not near.
 */
export function nearness(
  me: { locationCountry: string | null; locationRegion: string | null; locationDivision: string | null; locationSubdivision: string | null; locationQuarter: string | null; locationCity: string | null },
  other: { locationCountry: string | null; locationRegion: string | null; locationDivision: string | null; locationSubdivision: string | null; locationQuarter: string | null; locationCity: string | null },
): number {
  const same = (x: string | null, y: string | null) => Boolean(x && y && x.trim().toLowerCase() === y.trim().toLowerCase());
  if (!same(me.locationCountry, other.locationCountry)) return 0;
  if (me.locationRegion) {
    if (!same(me.locationRegion, other.locationRegion)) return 0;
    if (!same(me.locationDivision, other.locationDivision)) return 1;
    if (!same(me.locationSubdivision, other.locationSubdivision)) return 2;
    if (!same(me.locationQuarter, other.locationQuarter)) return 3;
    return 4;
  }
  return same(me.locationCity, other.locationCity) ? 1 : 0;
}
