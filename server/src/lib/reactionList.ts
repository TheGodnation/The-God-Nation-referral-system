import { prisma } from './prisma';
import { profilePhotoPath } from './profilePhoto';

// "Who reacted": tapping the reactions under a message, photo, voice note,
// video or post shows everyone who reacted and with what, WhatsApp style —
// the viewer first ("You"), then the most recent.

export interface ReactorRow {
  personId: string | null;
  userId?: string | null;
  reaction: string;
  createdAt: Date;
}

export interface Reactor {
  personId: string | null;
  name: string;
  photoUrl: string | null;
  reaction: string;
  isMe: boolean;
}

export async function reactorList(rows: ReactorRow[], viewer: { personId?: string | null; userId?: string | null }): Promise<{ total: number; items: Reactor[] }> {
  const personIds = [...new Set(rows.map((r) => r.personId).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
  const [people, users] = await Promise.all([
    personIds.length ? prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const items = [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r): Reactor | null => {
      const isMe = Boolean((r.personId && r.personId === viewer.personId) || (r.userId && r.userId === viewer.userId));
      if (r.personId) {
        const p = personById.get(r.personId);
        return p ? { personId: p.id, name: p.name, photoUrl: profilePhotoPath(p), reaction: r.reaction, isMe } : null;
      }
      const u = r.userId ? userById.get(r.userId) : null;
      return u ? { personId: null, name: u.name, photoUrl: null, reaction: r.reaction, isMe } : null;
    })
    .filter((r): r is Reactor => r !== null);
  items.sort((a, b) => Number(b.isMe) - Number(a.isMe));
  return { total: items.length, items };
}
