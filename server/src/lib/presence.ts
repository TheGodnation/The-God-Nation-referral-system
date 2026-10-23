import { prisma } from './prisma';
import { profilePhotoPath } from './profilePhoto';

// Online / last seen / typing — WhatsApp-style presence.
//
// "Online" means the person's app has talked to the server recently: the
// member app checks in every 30 seconds while it is open on screen (and
// every chat refreshes more often), and loadMemberSession records
// Person.lastSeenAt. When the app is closed or hidden, the check-ins stop
// and after ONLINE_WINDOW_MS the person shows as "last seen …".

export const ONLINE_WINDOW_MS = 75 * 1000;
/** Don't write lastSeenAt more often than this per person. */
export const LAST_SEEN_WRITE_EVERY_MS = 20 * 1000;

export function isOnline(lastSeenAt: Date | null | undefined, now = Date.now()): boolean {
  return Boolean(lastSeenAt) && now - lastSeenAt!.getTime() < ONLINE_WINDOW_MS;
}

/** Records that personId is using the app right now (throttled). */
export function touchLastSeen(personId: string, previous: Date | null | undefined): void {
  const now = Date.now();
  if (previous && now - previous.getTime() < LAST_SEEN_WRITE_EVERY_MS) return;
  prisma.person.update({ where: { id: personId }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
}

// ---------------------------------------------------------------- typing
// Kept in memory: "typing…" only matters for a few seconds, so it is never
// stored in the database. (One server instance; if there were several, a
// person might briefly not see "typing…" — harmless.)
const TYPING_FOR_MS = 6 * 1000;
const typing = new Map<string, Map<string, { name: string; until: number }>>();

export function setTyping(chatKey: string, personId: string, name: string): void {
  let chat = typing.get(chatKey);
  if (!chat) {
    chat = new Map();
    typing.set(chatKey, chat);
  }
  chat.set(personId, { name, until: Date.now() + TYPING_FOR_MS });
}

export function clearTyping(chatKey: string, personId: string): void {
  typing.get(chatKey)?.delete(personId);
}

/** Names of people typing in this chat now (never the viewer). */
export function whoIsTyping(chatKey: string, viewerPersonId: string | null): string[] {
  const chat = typing.get(chatKey);
  if (!chat) return [];
  const now = Date.now();
  const names: string[] = [];
  for (const [personId, entry] of chat) {
    if (entry.until < now) chat.delete(personId);
    else if (personId !== viewerPersonId) names.push(entry.name);
  }
  if (chat.size === 0) typing.delete(chatKey);
  return names;
}

// ---------------------------------------------------------------- groups

export interface AudienceMember {
  personId: string;
  name: string;
  photoUrl: string | null;
  lastSeenAt: Date | null;
}

/** Everyone who belongs to a group's chat: active members plus the
 * group's active leaders (each person once). */
export async function communityAudience(communityId: string): Promise<AudienceMember[]> {
  const select = { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true, lastSeenAt: true } as const;
  const [memberships, leaders] = await Promise.all([
    prisma.communityMembership.findMany({ where: { communityId, status: 'ACTIVE' }, select: { person: { select } } }),
    prisma.roleAssignment.findMany({
      where: { communityId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' },
      select: { person: { select } },
    }),
  ]);
  const byId = new Map<string, AudienceMember>();
  for (const row of [...memberships, ...leaders]) {
    const p = row.person;
    if (!p || byId.has(p.id)) continue;
    byId.set(p.id, { personId: p.id, name: p.name, photoUrl: profilePhotoPath(p), lastSeenAt: p.lastSeenAt });
  }
  return [...byId.values()];
}

export type TickStatus = 'sent' | 'delivered' | 'read';

/**
 * WhatsApp rule for one message in a group:
 *  ✓   sent       — saved on the server
 *  ✓✓  delivered  — every other person has opened the app since it was sent
 *  ✓✓  read(blue) — every other person has opened the chat since it was sent
 */
export function groupMessageReceipt(
  message: { createdAt: Date; senderPersonId: string },
  audience: AudienceMember[],
  readAtByPerson: Map<string, Date>,
) {
  const others = audience.filter((a) => a.personId !== message.senderPersonId);
  const t = message.createdAt.getTime();
  const readBy = others.filter((a) => (readAtByPerson.get(a.personId)?.getTime() ?? 0) >= t);
  const deliveredTo = others.filter(
    (a) => (readAtByPerson.get(a.personId)?.getTime() ?? 0) >= t || (a.lastSeenAt?.getTime() ?? 0) >= t,
  );
  const total = others.length;
  const status: TickStatus =
    total > 0 && readBy.length === total ? 'read' : total > 0 && deliveredTo.length === total ? 'delivered' : 'sent';
  return { status, total, readBy, deliveredTo };
}
