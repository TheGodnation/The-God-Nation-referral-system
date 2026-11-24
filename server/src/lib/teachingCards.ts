import { prisma } from './prisma';
import { profilePhotoPath } from './profilePhoto';
import { weekStartOf, addDays, dayKey } from './weeklyReports';
import { getOrCreateConversation } from './communityConversation';
import { pushToPerson } from './push';
import { isFrench } from './privateNotice';
import { DAY, MIN, LEVELS, RotaError, emptyCounts, isRater, loadBase, pickText, slotStart, topicNumberFor, weekNumber, type Level } from './teachingRota';

// The rating card in the teaching group's chat. When a teacher has finished (they tap "I have finished my teaching", or it
// happens by itself 25 minutes after their slot starts) a card is posted in the group, right after their voice notes:
// "{Name} has finished teaching {topic}. Listen to the teaching, then rate it." Members tap one of four levels, at any time,
// and can change their mind. The group sees how many gave each level and who rated, each with their name, photo and the level
// they gave. The National Coordinator counts as a rater, listed first. The teacher is told when someone
// rates (never by whom, in the phone alert). Nobody rates their own.

/** The card appears by itself this long after the slot starts, if the teacher has not tapped the button. */
export const AUTO_CARD_AFTER_MIN = 25;
/** A card that is overdue by more than this is not posted any more (the server was down for days). */
const AUTO_CARD_CUTOFF_DAYS = 3;
/** The "I have finished" button is there from the start of the slot until this long after it. */
const FINISH_WINDOW_HOURS = 24;
/** At most one phone alert per teaching in this time when people keep rating (the bell is updated every time). */
const RATED_PUSH_EVERY_MIN = 30;

export interface RatingCardInfo {
  teacherName: string;
  topic: string;
  /** How many people gave each level, and the total: the National Coordinator counts like everyone else. */
  total: number;
  counts: Record<Level, number>;
  /** Who rated: name, photo and level. The National Coordinator comes first (isCoordinator), then the others, newest first. */
  raters: { personId: string; name: string; photoUrl: string | null; level: Level; isCoordinator?: boolean }[];
  myLevel: Level | null;
  /** The central admin's own rating, visible to everyone. */
  coordinator: { name: string; level: Level } | null;
  isOwnTeaching: boolean;
  canRate: boolean;
}

const isLevel = (x: string): x is Level => (LEVELS as readonly string[]).includes(x);

/** The card info for these messages as this viewer should see it. */
export async function ratingCardInfos(viewerPersonId: string, messageIds: string[], lang: 'en' | 'fr'): Promise<Map<string, RatingCardInfo>> {
  const out = new Map<string, RatingCardInfo>();
  if (messageIds.length === 0) return out;
  const cards = await prisma.teachingRatingCard.findMany({ where: { messageId: { in: messageIds } } });
  if (cards.length === 0) return out;
  const { settings, topics } = await loadBase();
  if (!settings) return out;
  const numbers = topics.map((t) => t.number);
  const teachers = await prisma.teachingTeacher.findMany({ where: { id: { in: [...new Set(cards.map((c) => c.teacherId))] } } });
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const ratings = await prisma.teachingRating.findMany({ where: { teacherId: { in: teachers.map((t) => t.id) }, weekStart: { in: cards.map((c) => c.weekStart) } } });
  const admins = new Set((await prisma.user.findMany({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } })).map((u) => u.personId!));
  const people = await prisma.person.findMany({
    where: { id: { in: [...new Set([...teachers.map((t) => t.personId).filter((x): x is string => Boolean(x)), ...ratings.map((r) => r.raterPersonId)])] } },
    select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const viewerIsRater = await isRater(viewerPersonId);

  for (const card of cards) {
    const teacher = teacherById.get(card.teacherId);
    if (!teacher) continue;
    const mine = ratings.filter((r) => r.teacherId === card.teacherId && r.weekStart.getTime() === card.weekStart.getTime());
    const counts = emptyCounts();
    let coordinator: RatingCardInfo['coordinator'] = null;
    const raters: RatingCardInfo['raters'] = [];
    for (const r of [...mine].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
      if (!isLevel(r.level)) continue;
      const isCoordinator = admins.has(r.raterPersonId);
      if (isCoordinator) coordinator = { name: nameOf.get(r.raterPersonId) ?? '', level: r.level };
      counts[r.level]++;
      const who = personById.get(r.raterPersonId);
      raters.push({ personId: r.raterPersonId, name: who?.name ?? '', photoUrl: who ? profilePhotoPath({ id: who.id, photoStorageKey: who.photoStorageKey, photoUpdatedAt: who.photoUpdatedAt }) : null, level: r.level, ...(isCoordinator ? { isCoordinator: true } : {}) });
    }
    raters.sort((a, b) => Number(Boolean(b.isCoordinator)) - Number(Boolean(a.isCoordinator))); // stable: the coordinator first, the rest newest first
    const topic = topics.find((t) => t.number === topicNumberFor(teacher.startTopic, numbers, weekNumber(settings.startDate, card.weekStart)));
    const myRow = mine.find((r) => r.raterPersonId === viewerPersonId);
    const isOwnTeaching = teacher.personId === viewerPersonId;
    out.set(card.messageId, {
      teacherName: (teacher.personId ? nameOf.get(teacher.personId) : null) ?? teacher.name,
      topic: topic ? pickText(lang, topic).text.topic : '',
      total: LEVELS.reduce((n, l) => n + counts[l], 0),
      counts,
      raters,
      myLevel: myRow && isLevel(myRow.level) ? myRow.level : null,
      coordinator,
      isOwnTeaching,
      canRate: !isOwnTeaching && viewerIsRater,
    });
  }
  return out;
}

/** Posts the card (once per teacher per week) in the teaching group's chat. */
async function postCard(teacherId: string, monday: Date): Promise<boolean> {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { enabled: true, ratersCommunityId: true } });
  if (!settings?.enabled || !settings.ratersCommunityId) return false;
  const teacher = await prisma.teachingTeacher.findUnique({ where: { id: teacherId } });
  if (!teacher?.personId || !teacher.active) return false;
  if (await prisma.teachingRatingCard.findUnique({ where: { teacherId_weekStart: { teacherId, weekStart: monday } } })) return false;
  const conversation = await getOrCreateConversation(settings.ratersCommunityId);
  const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: teacher.personId, kind: 'TEACHING_RATING' } });
  try {
    await prisma.teachingRatingCard.create({ data: { messageId: message.id, teacherId, weekStart: monday } });
  } catch {
    // Two taps at once: the other one won; remove the extra message.
    await prisma.message.delete({ where: { id: message.id } }).catch(() => {});
    return false;
  }
  return true;
}

/** The slot of this teacher that the "I have finished" button is about right now (the latest one that has started), if any. */
function currentSlot(teacher: { dayOfWeek: number; startMinute: number }, now: Date, startDate: Date) {
  const thisMonday = weekStartOf(now);
  for (const monday of [thisMonday, addDays(thisMonday, -7)]) {
    if (monday.getTime() < startDate.getTime()) continue; // before the first week there is no teaching to finish
    const startsAt = slotStart(monday, teacher.dayOfWeek, teacher.startMinute);
    if (startsAt.getTime() <= now.getTime() && now.getTime() < startsAt.getTime() + FINISH_WINDOW_HOURS * 60 * MIN) return { monday, startsAt };
  }
  return null;
}

/** Voice notes sent from this long before a teacher's slot starts, until this long after, count as "teaching now". */
const LIVE_EARLY_MIN = 30;
const LIVE_LATE_HOURS = 6;

export interface RotaLiveWindow {
  personId: string;
  /** Which teaching slot this is (the teacher and the Monday of its week), to find its "finished" rating card. */
  teacherId: string;
  monday: Date;
  /** The same for the whole slot, so the group is told once. */
  key: string;
  /** When the window opens (half an hour before the slot starts). */
  from: Date;
  topicEn: string | null;
  topicFr: string | null;
}

/**
 * Every teacher on the weekly rota whose slot is on right now in the teaching group (from half an hour before it starts until six
 * hours after), with the topic in both languages.
 */
export async function rotaLiveWindows(communityId: string, now = new Date()): Promise<RotaLiveWindow[]> {
  const { settings, topics } = await loadBase();
  if (!settings || !settings.enabled || settings.ratersCommunityId !== communityId) return [];
  const teachers = await prisma.teachingTeacher.findMany({ where: { active: true, personId: { not: null } } });
  const thisMonday = weekStartOf(now);
  const out: RotaLiveWindow[] = [];
  for (const teacher of teachers) {
    for (const monday of [thisMonday, addDays(thisMonday, 7), addDays(thisMonday, -7)]) {
      if (monday.getTime() < settings.startDate.getTime()) continue;
      const startsAt = slotStart(monday, teacher.dayOfWeek, teacher.startMinute).getTime();
      if (now.getTime() < startsAt - LIVE_EARLY_MIN * MIN || now.getTime() >= startsAt + LIVE_LATE_HOURS * 60 * MIN) continue;
      const topic = topics.find((t) => t.number === topicNumberFor(teacher.startTopic, topics.map((x) => x.number), weekNumber(settings.startDate, monday)));
      out.push({
        personId: teacher.personId!,
        teacherId: teacher.id,
        monday,
        key: `live:rota:${teacher.id}:${dayKey(monday)}`,
        from: new Date(startsAt - LIVE_EARLY_MIN * MIN),
        topicEn: topic ? pickText('en', topic).text.topic : null,
        topicFr: topic ? pickText('fr', topic).text.topic : null,
      });
      break;
    }
  }
  return out;
}

/** Is this member teaching right now in the teaching group? (See rotaLiveWindows.) */
export async function rotaTeachingNow(personId: string, communityId: string, now = new Date()): Promise<{ key: string; topicEn: string | null; topicFr: string | null } | null> {
  const w = (await rotaLiveWindows(communityId, now)).find((x) => x.personId === personId);
  return w ? { key: w.key, topicEn: w.topicEn, topicFr: w.topicFr } : null;
}

/** For the group chat: should this member see "I have finished my teaching" in this group right now? */
export async function finishState(personId: string, communityId: string, lang: 'en' | 'fr', now = new Date()): Promise<{ available: boolean; topic?: string }> {
  const { settings, topics } = await loadBase();
  if (!settings || !settings.enabled || settings.ratersCommunityId !== communityId) return { available: false };
  const teacher = await prisma.teachingTeacher.findFirst({ where: { personId, active: true } });
  if (!teacher) return { available: false };
  const slot = currentSlot(teacher, now, settings.startDate);
  if (!slot || now.getTime() < slot.startsAt.getTime()) return { available: false };
  if (await prisma.teachingRatingCard.findUnique({ where: { teacherId_weekStart: { teacherId: teacher.id, weekStart: slot.monday } } })) return { available: false };
  const topic = topics.find((t) => t.number === topicNumberFor(teacher.startTopic, topics.map((x) => x.number), weekNumber(settings.startDate, slot.monday)));
  return { available: true, topic: topic ? pickText(lang, topic).text.topic : undefined };
}

/** The teacher taps "I have finished my teaching": the rating card is posted in the group now. */
export async function finishTeaching(personId: string, now = new Date()) {
  const teacher = await prisma.teachingTeacher.findFirst({ where: { personId, active: true } });
  if (!teacher) throw new RotaError('You are not on the teaching list.', 403, 'NOT_A_TEACHER');
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { enabled: true, ratersCommunityId: true, startDate: true } });
  if (!settings?.enabled) throw new RotaError('The weekly teaching is not open.', 409, 'OFF');
  if (!settings.ratersCommunityId) throw new RotaError('No group is chosen for the teachings yet.', 409, 'NO_GROUP');
  const slot = currentSlot(teacher, now, settings.startDate);
  if (!slot || now.getTime() < slot.startsAt.getTime()) throw new RotaError('Your teaching time has not started yet.', 409, 'NOT_YET');
  const posted = await postCard(teacher.id, slot.monday);
  return { posted };
}

/** Posts the card for every teaching whose card is overdue (25 minutes after the slot started, the teacher did not tap). */
export async function postDueRatingCards(now = new Date()): Promise<number> {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { enabled: true, ratersCommunityId: true, startDate: true } });
  if (!settings?.enabled || !settings.ratersCommunityId) return 0;
  const teachers = await prisma.teachingTeacher.findMany({ where: { active: true, personId: { not: null } } });
  const thisMonday = weekStartOf(now);
  let posted = 0;
  for (const monday of [thisMonday, addDays(thisMonday, -7)]) {
    if (monday.getTime() < settings.startDate.getTime()) continue;
    for (const t of teachers) {
      const due = slotStart(monday, t.dayOfWeek, t.startMinute).getTime() + AUTO_CARD_AFTER_MIN * MIN;
      if (now.getTime() < due || now.getTime() > due + AUTO_CARD_CUTOFF_DAYS * DAY) continue;
      if (await postCard(t.id, monday)) posted++;
    }
  }
  return posted;
}

/** One member rates, changes, or takes back (level null) their rating of the teaching on a card. Allowed at any time. */
export async function rate(personId: string, input: { messageId: string; level: Level | null }) {
  const settings = await prisma.teachingSettings.findUnique({ where: { id: 'main' }, select: { enabled: true } });
  if (!settings?.enabled) throw new RotaError('The weekly teaching is not open.', 409, 'OFF');
  if (!(await isRater(personId))) throw new RotaError('You cannot rate the teachings.', 403, 'NOT_RATER');
  const card = await prisma.teachingRatingCard.findUnique({ where: { messageId: input.messageId } });
  if (!card) throw new RotaError('This teaching cannot be rated.', 404, 'NO_CARD');
  // A card the group's administrator removed (for example because the teacher did not teach) can no longer be rated.
  const cardMessage = await prisma.message.findUnique({ where: { id: input.messageId }, select: { deletedAt: true } });
  if (!cardMessage || cardMessage.deletedAt) throw new RotaError('This teaching cannot be rated.', 404, 'NO_CARD');
  const teacher = await prisma.teachingTeacher.findUnique({ where: { id: card.teacherId } });
  if (!teacher) throw new RotaError('This teaching cannot be rated.', 404, 'NO_CARD');
  if (teacher.personId === personId) throw new RotaError('You cannot rate your own teaching.', 403, 'OWN_TEACHING');
  if (input.level === null) {
    // Taking the rating back: it disappears from the card and the totals; the teacher's bell count is corrected quietly (no new alert).
    await prisma.teachingRating.deleteMany({ where: { teacherId: card.teacherId, weekStart: card.weekStart, raterPersonId: personId } });
    await refreshRatedBell(teacher, card.weekStart).catch((err) => console.error('[teaching-cards] could not update the teacher', { error: err instanceof Error ? err.message : String(err) }));
  } else {
    await prisma.teachingRating.upsert({
      where: { teacherId_weekStart_raterPersonId: { teacherId: card.teacherId, weekStart: card.weekStart, raterPersonId: personId } },
      create: { teacherId: card.teacherId, weekStart: card.weekStart, raterPersonId: personId, level: input.level },
      update: { level: input.level },
    });
    await notifyTeacherRated(teacher, card.weekStart).catch((err) => console.error('[teaching-cards] could not notify the teacher', { error: err instanceof Error ? err.message : String(err) }));
  }
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const info = (await ratingCardInfos(personId, [input.messageId], isFrench(person?.preferredLanguage) ? 'fr' : 'en')).get(input.messageId);
  return { ok: true, card: info ?? null };
}

/** After a rating was taken back: the teacher's bell entry shows the new count, or goes away when nobody is left. No alert, not unread again. */
async function refreshRatedBell(teacher: { id: string; personId: string | null }, monday: Date) {
  if (!teacher.personId) return;
  const week = dayKey(monday);
  const existing = await prisma.notification.findFirst({
    where: { recipientPersonId: teacher.personId, type: 'TEACHING_ROTA', AND: [{ metadata: { path: ['kind'], equals: 'rated' } }, { metadata: { path: ['weekStart'], equals: week } }] },
    select: { id: true, metadata: true },
  });
  if (!existing) return;
  const total = await prisma.teachingRating.count({ where: { teacherId: teacher.id, weekStart: monday } });
  if (total === 0) await prisma.notification.delete({ where: { id: existing.id } });
  else await prisma.notification.update({ where: { id: existing.id }, data: { metadata: { ...(existing.metadata as object), count: total } as any } });
}

/**
 * The teacher is told when someone rates: one entry in the bell for this teaching, kept up to date ("N people have rated your
 * teaching", never who or what), and a phone alert at most once every half hour for it.
 */
async function notifyTeacherRated(teacher: { id: string; personId: string | null; startTopic: number }, monday: Date) {
  if (!teacher.personId) return;
  const { settings, topics } = await loadBase();
  if (!settings) return;
  const topic = topics.find((t) => t.number === topicNumberFor(teacher.startTopic, topics.map((x) => x.number), weekNumber(settings.startDate, monday)));
  const week = dayKey(monday);
  const total = await prisma.teachingRating.count({ where: { teacherId: teacher.id, weekStart: monday } });
  const metadata = { kind: 'rated', weekStart: week, count: total, topicEn: topic ? pickText('en', topic).text.topic : '', topicFr: topic ? pickText('fr', topic).text.topic : '' };
  const existing = await prisma.notification.findFirst({
    where: { recipientPersonId: teacher.personId, type: 'TEACHING_ROTA', AND: [{ metadata: { path: ['kind'], equals: 'rated' } }, { metadata: { path: ['weekStart'], equals: week } }] },
    select: { id: true },
  });
  if (existing) await prisma.notification.update({ where: { id: existing.id }, data: { metadata: metadata as any, readAt: null, createdAt: new Date() } });
  else await prisma.notification.create({ data: { recipientPersonId: teacher.personId, type: 'TEACHING_ROTA', metadata: metadata as any, targetType: 'TeachingRota' } });

  const bucket = Math.floor(Date.now() / (RATED_PUSH_EVERY_MIN * MIN));
  const first = await prisma.teachingReminderLog.createMany({ data: [{ key: `rated-push:${teacher.id}:${week}:${bucket}` }], skipDuplicates: true });
  if (first.count !== 1) return;
  const person = await prisma.person.findUnique({ where: { id: teacher.personId }, select: { preferredLanguage: true } });
  const french = isFrench(person?.preferredLanguage);
  const title = topic ? pickText(french ? 'fr' : 'en', topic).text.topic : '';
  await pushToPerson(teacher.personId, {
    title: french ? '⭐ Votre enseignement a été noté' : '⭐ Your teaching was rated',
    body: french ? `${total} personne(s) ont noté : ${title}` : `${total} ${total === 1 ? 'person has' : 'people have'} rated: ${title}`,
    url: '/member/my-teaching',
    tag: `rota-rated-${teacher.id}`,
  }).catch(() => {});
}
