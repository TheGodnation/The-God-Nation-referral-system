import { prisma } from './prisma';

// The central admin's own member profile (a Person linked to an active
// ADMIN account — see lib/memberBridge.ts) carries the central admin's
// powers inside the member app, so they can simply teach and post as
// themselves: they can open, write in and moderate every assembly's chat,
// moderate the home page and prayer requests, and see every teacher's
// report. Signing in to that profile on a new phone also needs the code
// emailed to it (see memberAuth.ts). Their name shows the "National
// Coordinator" badge.

/** Whether this person is the active central admin's own member profile. */
export async function isCentralAdminPerson(personId: string | null | undefined): Promise<boolean> {
  if (!personId) return false;
  const user = await prisma.user.findUnique({ where: { personId }, select: { role: true, active: true } });
  return Boolean(user && user.role === 'ADMIN' && user.active);
}

/** Of these people, the ones who are the central admin (for the badge next to their name). */
export async function centralAdminAmong(personIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(personIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Set();
  const users = await prisma.user.findMany({ where: { personId: { in: ids }, role: 'ADMIN', active: true }, select: { personId: true } });
  return new Set(users.map((u) => u.personId!));
}

/** The badge shown next to a name. */
export type PersonBadge = 'NATIONAL_COORDINATOR' | null;
export const badgeOf = (admins: Set<string>, personId: string | null | undefined): PersonBadge => (personId && admins.has(personId) ? 'NATIONAL_COORDINATOR' : null);
