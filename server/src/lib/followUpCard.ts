import { prisma } from './prisma';
import { requiredLeadershipExamIds, schoolProgressAmong } from './cells';

// ---------------------------------------------------------------------------
// The follow-up card: everything a leader needs to know about one of "my
// people" on one screen. Computed fresh from the existing records (contact
// log, the private chat between the leader and the person, prayer requests,
// attendance, teachings, the Leadership School and book payments) — nothing
// new is stored. The person never sees their own card; only the leaders
// who follow them (and the central administration) do.
// ---------------------------------------------------------------------------

/** A leader should be in touch with each of their people at least this many days a week. */
export const CONTACT_DAYS_PER_WEEK = 2;
const DAY = 24 * 60 * 60 * 1000;

export type CardFlag =
  | 'EMERGENCY'
  | 'NEEDS_ATTENTION'
  | 'UNABLE_TO_REACH'
  | 'OVERDUE'
  | 'NOT_YET_CONTACTED'
  | 'CONTACT_TWICE_WEEK'
  | 'NO_REPLY'
  | 'SCHOOL_SLOW'
  | 'PAYMENT_OWED';

// Most urgent first.
const FLAG_ORDER: CardFlag[] = ['EMERGENCY', 'NEEDS_ATTENTION', 'UNABLE_TO_REACH', 'OVERDUE', 'NO_REPLY', 'NOT_YET_CONTACTED', 'CONTACT_TWICE_WEEK', 'SCHOOL_SLOW', 'PAYMENT_OWED'];

export interface FollowUpCard {
  followUpAssignmentId: string;
  personId: string;
  name: string;
  /** What a leader may see about the people they look after: their WhatsApp number and the language they read. */
  whatsapp: string | null;
  language: 'en' | 'fr';
  assignedAt: string;
  /** Last time the leader was in touch (a logged contact or a message). */
  lastContactAt: string | null;
  /** Days with some contact in the last 7 days, and the target. */
  contactDaysThisWeek: number;
  contactTarget: number;
  /** The person has answered since the leader last wrote (null: the leader has not written yet). */
  replied: boolean | null;
  lastReplyAt: string | null;
  wellbeing: 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH' | null;
  note: string | null;
  nextAction: { date: string; overdue: boolean } | null;
  prayerRequests: number;
  attendance: { attended: number; events: number };
  teachingsFinished: number;
  school: { passed: number; required: number };
  payment: { owedBooks: number; waitingConfirmation: number };
  flags: CardFlag[];
  /** The chat with this person (null until the first message is sent). */
  conversationId: string | null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function followUpCardsFor(followerId: string, now = new Date()): Promise<FollowUpCard[]> {
  const assignments = await prisma.followUpAssignment.findMany({
    where: { followerId, status: 'ACTIVE' },
    include: { followedPerson: { select: { id: true, name: true, whatsappNumber: true, preferredLanguage: true } } },
    orderBy: { assignedAt: 'asc' },
  });
  if (assignments.length === 0) return [];

  const personIds = assignments.map((a) => a.followedPersonId);
  const assignmentIds = assignments.map((a) => a.id);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const twoMonthsAgo = new Date(now.getTime() - 60 * DAY);
  const communityIds = [...new Set(assignments.map((a) => a.contextId))];

  const [contacts, conversations, prayers, attendances, events, teachings, school, opens, payments, enrollments] = await Promise.all([
    prisma.followUpContact.findMany({
      where: { followUpAssignmentId: { in: assignmentIds } },
      orderBy: { contactedAt: 'desc' },
      select: { followUpAssignmentId: true, contactedAt: true, wellbeingStatus: true, note: true, nextFollowUpDate: true },
    }),
    prisma.privateConversation.findMany({
      where: { initiatorPersonId: followerId, memberPersonId: { in: personIds } },
      select: { id: true, memberPersonId: true },
    }),
    prisma.prayerRequest.groupBy({
      by: ['authorPersonId'],
      where: { authorPersonId: { in: personIds }, deletedAt: null, createdAt: { gte: twoMonthsAgo } },
      _count: { _all: true },
    }),
    prisma.eventAttendance.groupBy({
      by: ['personId'],
      where: { personId: { in: personIds }, event: { startsAt: { gte: monthAgo, lte: now }, cancelledAt: null } },
      _count: { _all: true },
    }),
    prisma.assemblyEvent.groupBy({
      by: ['communityId'],
      where: { communityId: { in: communityIds }, startsAt: { gte: monthAgo, lte: now }, cancelledAt: null },
      _count: { _all: true },
    }),
    prisma.teachingProgress.groupBy({
      by: ['personId'],
      where: { personId: { in: personIds }, completedAt: { gte: monthAgo } },
      _count: { _all: true },
    }),
    schoolProgressAmong(personIds),
    prisma.trainingBookOpen.findMany({ where: { personId: { in: personIds } }, select: { personId: true, bookId: true } }),
    prisma.bookPayment.findMany({
      where: { personId: { in: personIds }, status: { in: ['CONFIRMED', 'CLAIMED', 'PENDING'] } },
      select: { personId: true, bookId: true, status: true },
    }),
    prisma.trainingEnrollment.findMany({ where: { personId: { in: personIds } }, select: { personId: true } }),
  ]);
  void enrollments;

  // Slow in the Leadership School: started, not finished, and nothing passed or opened for a month.
  const examIds = await requiredLeadershipExamIds();
  const lastPasses = examIds.length
    ? await prisma.attempt.groupBy({
        by: ['personId'],
        where: { personId: { in: personIds }, assessmentId: { in: examIds }, status: 'SUBMITTED', passed: true },
        _max: { submittedAt: true },
      })
    : [];
  const lastOpens = await prisma.trainingBookOpen.groupBy({ by: ['personId'], where: { personId: { in: personIds } }, _max: { openedAt: true } });
  const lastSchoolActivity = new Map<string, Date>();
  for (const r of lastPasses) if (r._max.submittedAt) lastSchoolActivity.set(r.personId, r._max.submittedAt);
  for (const r of lastOpens) {
    const prev = lastSchoolActivity.get(r.personId);
    if (r._max.openedAt && (!prev || r._max.openedAt > prev)) lastSchoolActivity.set(r.personId, r._max.openedAt);
  }

  const conversationByPerson = new Map(conversations.map((c) => [c.memberPersonId, c.id]));
  const messages = conversations.length
    ? await prisma.privateMessage.findMany({
        where: { conversationId: { in: conversations.map((c) => c.id) }, deletedAt: null, createdAt: { gte: monthAgo } },
        select: { conversationId: true, senderPersonId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  // Older than a month still counts as "last contact": look for the single newest leader message too.
  const newestLeaderMessage = conversations.length
    ? await prisma.privateMessage.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: conversations.map((c) => c.id) }, senderPersonId: followerId, deletedAt: null },
        _max: { createdAt: true },
      })
    : [];
  const newestLeaderByConv = new Map(newestLeaderMessage.map((m) => [m.conversationId, m._max.createdAt]));

  const prayerBy = new Map(prayers.map((p) => [p.authorPersonId, p._count._all]));
  const attendedBy = new Map(attendances.map((a) => [a.personId, a._count._all]));
  const eventsBy = new Map(events.map((e) => [e.communityId, e._count._all]));
  const teachingsBy = new Map(teachings.map((t) => [t.personId, t._count._all]));

  const paidBooks = new Set(payments.filter((p) => p.status === 'CONFIRMED').map((p) => `${p.personId}:${p.bookId}`));
  const waitingBy = new Map<string, number>();
  for (const p of payments) if (p.status !== 'CONFIRMED') waitingBy.set(p.personId!, (waitingBy.get(p.personId!) ?? 0) + 1);
  const owedBy = new Map<string, number>();
  for (const o of opens) if (!paidBooks.has(`${o.personId}:${o.bookId}`)) owedBy.set(o.personId, (owedBy.get(o.personId) ?? 0) + 1);

  const cards: FollowUpCard[] = assignments.map((a) => {
    const personId = a.followedPersonId;
    const myContacts = contacts.filter((c) => c.followUpAssignmentId === a.id);
    const latest = myContacts[0] ?? null;
    const conversationId = conversationByPerson.get(personId) ?? null;
    const convMessages = conversationId ? messages.filter((m) => m.conversationId === conversationId) : [];
    const leaderMsgs = convMessages.filter((m) => m.senderPersonId === followerId);
    const personMsgs = convMessages.filter((m) => m.senderPersonId === personId);
    const lastLeaderMsgAt = (conversationId ? newestLeaderByConv.get(conversationId) : null) ?? null;
    const lastPersonMsg = personMsgs[0]?.createdAt ?? null;

    const contactDays = new Set<string>();
    for (const c of myContacts) if (c.contactedAt >= weekAgo) contactDays.add(dayKey(c.contactedAt));
    for (const m of leaderMsgs) if (m.createdAt >= weekAgo) contactDays.add(dayKey(m.createdAt));

    const lastContactAt = [latest?.contactedAt ?? null, lastLeaderMsgAt].filter((d): d is Date => Boolean(d)).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    const replied = lastLeaderMsgAt ? Boolean(lastPersonMsg && lastPersonMsg > lastLeaderMsgAt) : null;
    const next = latest?.nextFollowUpDate ?? null;

    const flags = new Set<CardFlag>();
    if (latest?.wellbeingStatus === 'EMERGENCY') flags.add('EMERGENCY');
    if (latest?.wellbeingStatus === 'NEEDS_ATTENTION') flags.add('NEEDS_ATTENTION');
    if (latest?.wellbeingStatus === 'UNABLE_TO_REACH') flags.add('UNABLE_TO_REACH');
    if (next && next < now) flags.add('OVERDUE');
    if (!lastContactAt) flags.add('NOT_YET_CONTACTED');
    const settledIn = now.getTime() - a.assignedAt.getTime() > 3 * DAY;
    if (settledIn && contactDays.size < CONTACT_DAYS_PER_WEEK) flags.add('CONTACT_TWICE_WEEK');
    if (lastLeaderMsgAt && replied === false && now.getTime() - lastLeaderMsgAt.getTime() > 3 * DAY) flags.add('NO_REPLY');
    const lastSchool = lastSchoolActivity.get(personId);
    const passedBooks = school.passed.get(personId) ?? 0;
    if (lastSchool && school.required > 0 && passedBooks < school.required && now.getTime() - lastSchool.getTime() > 30 * DAY) flags.add('SCHOOL_SLOW');
    if ((owedBy.get(personId) ?? 0) > 0) flags.add('PAYMENT_OWED');

    return {
      followUpAssignmentId: a.id,
      personId,
      name: a.followedPerson.name,
      whatsapp: a.followedPerson.whatsappNumber,
      language: a.followedPerson.preferredLanguage === 'fr' ? ('fr' as const) : ('en' as const),
      assignedAt: a.assignedAt.toISOString(),
      lastContactAt: lastContactAt?.toISOString() ?? null,
      contactDaysThisWeek: contactDays.size,
      contactTarget: CONTACT_DAYS_PER_WEEK,
      replied,
      lastReplyAt: lastPersonMsg?.toISOString() ?? null,
      wellbeing: latest?.wellbeingStatus ?? null,
      note: latest?.note ?? null,
      nextAction: next ? { date: next.toISOString(), overdue: next < now } : null,
      prayerRequests: prayerBy.get(personId) ?? 0,
      attendance: { attended: attendedBy.get(personId) ?? 0, events: eventsBy.get(a.contextId) ?? 0 },
      teachingsFinished: teachingsBy.get(personId) ?? 0,
      school: { passed: school.passed.get(personId) ?? 0, required: school.required },
      payment: { owedBooks: owedBy.get(personId) ?? 0, waitingConfirmation: waitingBy.get(personId) ?? 0 },
      flags: FLAG_ORDER.filter((f) => flags.has(f)),
      conversationId,
    };
  });

  // Who needs the leader first: most urgent flag, then most flags, then longest without contact.
  const rank = (c: FollowUpCard) => (c.flags.length ? FLAG_ORDER.indexOf(c.flags[0]) : FLAG_ORDER.length);
  cards.sort(
    (x, y) =>
      rank(x) - rank(y) ||
      y.flags.length - x.flags.length ||
      (x.lastContactAt ?? '').localeCompare(y.lastContactAt ?? '') ||
      x.name.localeCompare(y.name),
  );
  return cards;
}
