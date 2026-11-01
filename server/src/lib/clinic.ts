import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';
import { isCentralAdminPerson } from './centralAdmin';
import { getOrCreatePrivateConversation } from './privateMessaging';
import { notifyPrivateMessageReceived } from './notifications';

// ---------------------------------------------------------------------------
// Dominion Clinic delivery. The monthly book is SENT to each member: by their
// leader in one tap (a private message from the leader), by the central admin
// to everyone, or automatically two days after it opened if nobody sent it
// (leaders themselves get it at once). Only a member it was sent to can open
// it; the central admin always can. The book also sits in the library.
// ---------------------------------------------------------------------------

export const AUTO_SEND_AFTER_MS = 48 * 60 * 60 * 1000;

export interface ClinicBook {
  bookId: string;
  devotionalId: string;
  titleEn: string;
  titleFr: string | null;
  communityId: string | null;
  startDate: Date;
}

/** This month's Dominion Clinic book: the newest published monthly book that has a file and is running now. */
export async function currentClinicBook(now = new Date()): Promise<ClinicBook | null> {
  const d = await prisma.monthlyDevotional.findFirst({
    where: { status: 'PUBLISHED', startDate: { lte: now }, endDate: { gte: now }, book: { is: { OR: [{ storageKey: { not: null } }, { storageKeyFr: { not: null } }] } } },
    orderBy: { startDate: 'desc' },
    include: { book: { select: { id: true } } },
  });
  if (!d?.book) return null;
  return { bookId: d.book.id, devotionalId: d.id, titleEn: d.titleEn, titleFr: d.titleFr, communityId: d.communityId, startDate: d.startDate };
}

/** Members who may be sent the book: everyone active (or the members of the one assembly it is made for). */
async function eligibleMembers(book: ClinicBook): Promise<{ personId: string; joinedAt: Date }[]> {
  const rows = await prisma.communityMembership.findMany({
    where: { status: 'ACTIVE', ...(book.communityId ? { communityId: book.communityId } : {}) },
    select: { personId: true, joinedAt: true },
  });
  const first = new Map<string, Date>();
  for (const r of rows) {
    const prev = first.get(r.personId);
    if (!prev || r.joinedAt < prev) first.set(r.personId, r.joinedAt);
  }
  return [...first].map(([personId, joinedAt]) => ({ personId, joinedAt }));
}

export async function deliveredPersonIds(bookId: string): Promise<Set<string>> {
  const rows = await prisma.bookDelivery.findMany({ where: { bookId }, select: { personId: true } });
  return new Set(rows.map((r) => r.personId));
}

/** Whether this person can open this monthly book (it was sent to them; the central admin always can). */
export async function bookWasSentTo(personId: string, bookId: string): Promise<boolean> {
  if (await prisma.bookDelivery.findUnique({ where: { personId_bookId: { personId, bookId } }, select: { id: true } })) return true;
  return isCentralAdminPerson(personId);
}

export const sentMessage = (title: { en: string; fr: string }, language: 'en' | 'fr') =>
  language === 'fr'
    ? `Votre livre Clinique de la Domination est arrivé : « ${title.fr} ». Ouvrez-le dans votre bibliothèque, ou depuis l'enseignement du jour dans votre assemblée.`
    : `Your Dominion Clinic book has arrived: "${title.en}". Open it from your library, or from today's teaching in your assembly.`;

export type Sender = { kind: 'LEADER'; personId: string } | { kind: 'ADMIN'; userId: string; via: 'ADMIN' | 'AUTO' };

/** Sends the book to these people (skipping those who already have it), each as a private message. */
export async function deliverBook(book: ClinicBook, personIds: string[], sender: Sender): Promise<{ sent: number; alreadyHad: number }> {
  const have = await deliveredPersonIds(book.bookId);
  const people = await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, preferredLanguage: true } });
  let sent = 0;
  let alreadyHad = 0;
  for (const p of people) {
    if (have.has(p.id)) {
      alreadyHad += 1;
      continue;
    }
    try {
      await prisma.bookDelivery.create({
        data: { personId: p.id, bookId: book.bookId, via: sender.kind === 'LEADER' ? 'LEADER' : sender.via, sentByPersonId: sender.kind === 'LEADER' ? sender.personId : null },
      });
    } catch {
      alreadyHad += 1; // someone sent it at the same moment
      continue;
    }
    const body = sentMessage({ en: book.titleEn, fr: book.titleFr ?? book.titleEn }, p.preferredLanguage === 'fr' ? 'fr' : 'en');
    if (sender.kind === 'LEADER') {
      const conversation = await getOrCreatePrivateConversation(p.id, { type: 'PERSON', personId: sender.personId });
      await prisma.privateMessage.create({ data: { conversationId: conversation.id, senderPersonId: sender.personId, body } });
      await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: sender.personId }).catch(() => {});
    } else {
      const conversation = await getOrCreatePrivateConversation(p.id, { type: 'USER', userId: sender.userId });
      await prisma.privateMessage.create({ data: { conversationId: conversation.id, senderUserId: sender.userId, body } });
      await notifyPrivateMessageReceived(conversation, { type: 'USER', userId: sender.userId }).catch(() => {});
    }
    sent += 1;
  }
  return { sent, alreadyHad };
}

export interface LeaderClinicStatus {
  book: { id: string; titleEn: string; titleFr: string | null } | null;
  people: number;
  sent: number;
  waiting: number;
}

/** What a leader sees: this month's book, how many of their people have it, how many are waiting. */
export async function leaderClinicStatus(leaderPersonId: string, now = new Date()): Promise<LeaderClinicStatus> {
  const book = await currentClinicBook(now);
  const assignments = await prisma.followUpAssignment.findMany({ where: { followerId: leaderPersonId, status: 'ACTIVE' }, select: { followedPersonId: true } });
  if (!book) return { book: null, people: assignments.length, sent: 0, waiting: 0 };
  const ids = [...new Set(assignments.map((a) => a.followedPersonId))];
  const have = await deliveredPersonIds(book.bookId);
  const sent = ids.filter((id) => have.has(id)).length;
  return { book: { id: book.bookId, titleEn: book.titleEn, titleFr: book.titleFr }, people: ids.length, sent, waiting: ids.length - sent };
}

/** One tap: send this month's book to every one of the leader's people who does not have it yet. */
export async function leaderSendsBook(leaderPersonId: string, now = new Date()) {
  const book = await currentClinicBook(now);
  if (!book) return null;
  const assignments = await prisma.followUpAssignment.findMany({ where: { followerId: leaderPersonId, status: 'ACTIVE' }, select: { followedPersonId: true } });
  const eligible = new Set((await eligibleMembers(book)).map((m) => m.personId));
  const ids = [...new Set(assignments.map((a) => a.followedPersonId))].filter((id) => eligible.has(id));
  return deliverBook(book, ids, { kind: 'LEADER', personId: leaderPersonId });
}

export interface AdminClinicStatus {
  book: { id: string; titleEn: string; titleFr: string | null } | null;
  members: number;
  sent: number;
  waiting: number;
}

export async function adminClinicStatus(now = new Date()): Promise<AdminClinicStatus> {
  const book = await currentClinicBook(now);
  if (!book) return { book: null, members: 0, sent: 0, waiting: 0 };
  const members = await eligibleMembers(book);
  const have = await deliveredPersonIds(book.bookId);
  const sent = members.filter((m) => have.has(m.personId)).length;
  return { book: { id: book.bookId, titleEn: book.titleEn, titleFr: book.titleFr }, members: members.length, sent, waiting: members.length - sent };
}

async function firstAdminUserId(): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  return u?.id ?? null;
}

/** The central admin sends this month's book to everyone who does not have it. */
export async function adminSendsBookToAll(actorUserId: string, now = new Date()) {
  const book = await currentClinicBook(now);
  if (!book) return null;
  const members = await eligibleMembers(book);
  return deliverBook(book, members.map((m) => m.personId), { kind: 'ADMIN', userId: actorUserId, via: 'ADMIN' });
}

/**
 * The fallback: two days after the book opened (or after someone joined),
 * everyone who still does not have it is sent it, as a private message from
 * the central administration. Leaders get it at once. Returns how many were sent.
 */
export async function processClinicAutoSend(now = new Date()): Promise<number> {
  const book = await currentClinicBook(now);
  if (!book) return 0;
  const userId = await firstAdminUserId();
  if (!userId) return 0;
  const [members, have, leaders] = await Promise.all([
    eligibleMembers(book),
    deliveredPersonIds(book.bookId),
    prisma.roleAssignment.findMany({ where: { status: 'ACTIVE' }, select: { personId: true } }),
  ]);
  const leaderIds = new Set(leaders.map((l) => l.personId));
  const due = members
    .filter((m) => !have.has(m.personId))
    .filter((m) => leaderIds.has(m.personId) || now.getTime() - Math.max(book.startDate.getTime(), m.joinedAt.getTime()) >= AUTO_SEND_AFTER_MS)
    .map((m) => m.personId);
  if (due.length === 0) return 0;
  const r = await deliverBook(book, due, { kind: 'ADMIN', userId, via: 'AUTO' });
  return r.sent;
}

export function startClinicAutoSendLoop(): void {
  startAdaptiveLoop(processClinicAutoSend, (err) => console.error('[clinic] auto-send failed', { error: err instanceof Error ? err.message : String(err) }));
}
