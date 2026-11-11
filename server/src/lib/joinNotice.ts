import { prisma } from './prisma';
import { getOrCreateConversation } from './communityConversation';
import { isCentralAdminPerson } from './centralAdmin';

// "Just joined": when someone joins an assembly or group, its chat shows a line with their name so the others can
// welcome them. Nothing is shown when someone leaves. The line is a message of kind JOINED, written by the person who
// joined (so it carries their name and opens their profile). It never sends a push, is never counted as unread, and
// never counts as the person having written anything.
//
// One line per person. When many people are added at once (the "add many people" tool), one line says how many.

/** More than this many people added at once are announced as one line ("42 people have just joined"). */
export const MAX_NAMED_JOINS = 10;
/** The same person is not announced twice within this time (double taps, retries). */
const REPEAT_WINDOW_MS = 60 * 1000;

/** Never throws: a failure here must never undo adding the person. */
export async function announceJoined(communityId: string, personIds: string[]): Promise<void> {
  try {
    const unique = [...new Set(personIds)];
    if (unique.length === 0) return;
    const people = await prisma.person.findMany({ where: { id: { in: unique }, erasedAt: null, deletionRequestedAt: null }, select: { id: true } });
    const eligible: string[] = [];
    for (const p of people) if (!(await isCentralAdminPerson(p.id))) eligible.push(p.id);
    if (eligible.length === 0) return;
    const conversation = await getOrCreateConversation(communityId);
    const recent = await prisma.message.findMany({
      where: { conversationId: conversation.id, kind: 'JOINED', senderPersonId: { in: eligible }, createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) } },
      select: { senderPersonId: true },
    });
    const already = new Set(recent.map((m) => m.senderPersonId));
    const fresh = eligible.filter((id) => !already.has(id));
    if (fresh.length === 0) return;
    if (fresh.length <= MAX_NAMED_JOINS) {
      for (const personId of fresh) {
        await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: personId, kind: 'JOINED' } });
      }
    } else {
      // One line for the whole group; the number is kept in the body.
      await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: fresh[0], kind: 'JOINED', body: String(fresh.length) } });
    }
  } catch (err) {
    console.error('[joinNotice] could not announce a join', { communityId, error: err instanceof Error ? err.message : String(err) });
  }
}
