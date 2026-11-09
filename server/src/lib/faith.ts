import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { notifyFaithNeedsConversation } from './notifications';

// ---------------------------------------------------------------------------
// Faith journey. The Book 1 and Book 2 exams end with "Section C", personal
// questions that are never marked: they tell the central admin (and, when he
// allows it, the person's own leaders) where each person stands with Christ,
// so they can talk with them. Members never see anyone's answers.
//
// Status, from the answers of the person's latest try:
//   BORN_AGAIN          every question that decides status was answered with a
//                       clear "yes" / "I agree", and nothing typed was flagged.
//   NEEDS_CONVERSATION  anything else (not yet, not sure, doubts, "I do not agree").
// Only a question marked affectsStatus counts (the salvation questions); the
// others (Bible reading, availability to serve) are shown flagged in the journey.
// ---------------------------------------------------------------------------

const NONE_WORDS = new Set(['nothing', 'none', 'nil', 'no', 'n/a', 'na', 'rien', 'aucun', 'aucune', 'non', '-']);

/** "nothing", "None.", "rien" ... : the person says there is nothing holding them back. */
export function saysNothing(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[.!"'“”«»]/g, '')
    .trim();
  return t === '' || NONE_WORDS.has(t);
}

export interface PersonalQuestionRow {
  id: string;
  order: number;
  kind: 'CHOICE' | 'TEXT';
  textEn: string;
  textFr: string | null;
  bodyEn: string | null;
  bodyFr: string | null;
  guideEn: string | null;
  guideFr: string | null;
  required: boolean;
  flagUnlessNone: boolean;
  affectsStatus: boolean;
  options: { id: string; order: number; textEn: string; textFr: string | null; signal: 'POSITIVE' | 'NEEDS_TALK' }[];
}

export async function personalQuestionsFor(assessmentId: string, setNumber: number): Promise<PersonalQuestionRow[]> {
  return prisma.personalQuestion.findMany({
    where: { assessmentId, setNumber },
    orderBy: { order: 'asc' },
    include: { options: { orderBy: { order: 'asc' } } },
  });
}

export interface PersonalSubmission {
  questionId: string;
  optionId?: string;
  text?: string;
}

export interface PreparedAnswer {
  questionId: string;
  optionId: string | null;
  order: number;
  signal: 'POSITIVE' | 'NEEDS_TALK';
  questionEn: string;
  questionFr: string | null;
  answerEn: string;
  answerFr: string | null;
  guideEn: string | null;
  guideFr: string | null;
}

export class PersonalAnswersError extends Error {
  constructor(public missing: string[]) {
    super('Please answer every personal question before you finish.');
  }
}

const MAX_TEXT = 2000;

/** Checks the submitted personal answers against the set's questions; every required question needs an answer. */
export function prepareAnswers(questions: PersonalQuestionRow[], submitted: PersonalSubmission[]): PreparedAnswer[] {
  const byQuestion = new Map(submitted.map((s) => [s.questionId, s]));
  const out: PreparedAnswer[] = [];
  const missing: string[] = [];
  for (const q of questions) {
    const s = byQuestion.get(q.id);
    const base = { questionId: q.id, order: q.order, questionEn: q.textEn, questionFr: q.textFr, guideEn: q.guideEn, guideFr: q.guideFr };
    if (q.kind === 'CHOICE') {
      const option = s?.optionId ? q.options.find((o) => o.id === s.optionId) : undefined;
      if (!option) {
        if (q.required) missing.push(q.id);
        continue;
      }
      out.push({ ...base, optionId: option.id, signal: option.signal, answerEn: option.textEn, answerFr: option.textFr });
    } else {
      const text = (s?.text ?? '').trim().slice(0, MAX_TEXT);
      if (!text) {
        if (q.required) missing.push(q.id);
        continue;
      }
      out.push({ ...base, optionId: null, signal: q.flagUnlessNone && !saysNothing(text) ? 'NEEDS_TALK' : 'POSITIVE', answerEn: text, answerFr: null });
    }
  }
  if (missing.length) throw new PersonalAnswersError(missing);
  return out;
}

/** Saves the answers of one try (replacing any saved earlier for the same try). */
export async function savePersonalAnswers(attempt: { id: string; personId: string; setNumber: number | null }, answers: PreparedAnswer[]) {
  await prisma.$transaction([
    prisma.personalAnswer.deleteMany({ where: { attemptId: attempt.id } }),
    prisma.personalAnswer.createMany({
      data: answers.map((a) => ({ ...a, attemptId: attempt.id, personId: attempt.personId, setNumber: attempt.setNumber ?? 1 })),
    }),
  ]);
}

export type FaithStatusValue = 'BORN_AGAIN' | 'NEEDS_CONVERSATION';

export function statusOf(questions: PersonalQuestionRow[], answers: PreparedAnswer[]): FaithStatusValue {
  const counts = new Set(questions.filter((q) => q.affectsStatus).map((q) => q.id));
  const needs = answers.some((a) => counts.has(a.questionId) && a.signal === 'NEEDS_TALK');
  return needs ? 'NEEDS_CONVERSATION' : 'BORN_AGAIN';
}

/** The leaders who may read a person's journey when the central admin has allowed it: those of the assemblies they belong to. */
export async function leaderPersonIdsOf(personId: string): Promise<string[]> {
  const memberships = await prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } });
  if (memberships.length === 0) return [];
  const roles = await prisma.roleAssignment.findMany({
    where: { roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { in: memberships.map((m) => m.communityId) }, personId: { not: personId } },
    select: { personId: true },
  });
  return [...new Set(roles.map((r) => r.personId))];
}

export async function leadersMaySee(): Promise<boolean> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { leadersSeeFaithJourney: true } });
  return Boolean(s?.leadersSeeFaithJourney);
}

/** After a try's personal answers are saved and the try is submitted: update where the person stands and tell whoever should know. */
export async function recordFaith(
  attempt: { id: string; personId: string; assessmentId: string },
  questions: PersonalQuestionRow[],
  answers: PreparedAnswer[],
) {
  const status = statusOf(questions, answers);
  const now = new Date();
  await prisma.faithRecord.upsert({
    where: { personId: attempt.personId },
    create: { personId: attempt.personId, status, lastAttemptId: attempt.id, lastAnsweredAt: now },
    update: { status, lastAttemptId: attempt.id, lastAnsweredAt: now },
  });
  if (status !== 'NEEDS_CONVERSATION') return status;

  const [person, exam, admins, allowLeaders] = await Promise.all([
    prisma.person.findUnique({ where: { id: attempt.personId }, select: { id: true, name: true } }),
    prisma.assessment.findUnique({ where: { id: attempt.assessmentId }, select: { trainingBook: { select: { trainingOrder: true } } } }),
    prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true, personId: true } }),
    leadersMaySee(),
  ]);
  if (!person) return status;
  const bookNumber = exam?.trainingBook?.trainingOrder ?? null;
  const tasks: Promise<unknown>[] = admins.map((a) => notifyFaithNeedsConversation({ personId: a.personId, userId: a.id }, person, bookNumber));
  if (allowLeaders) {
    for (const leaderId of await leaderPersonIdsOf(person.id)) tasks.push(notifyFaithNeedsConversation({ personId: leaderId }, person, bookNumber));
  }
  await Promise.allSettled(tasks);
  return status;
}

// ----------------------------- Who may read ---------------------------------

export type FaithViewer = { kind: 'ADMIN'; name: string; personId: string | null } | { kind: 'LEADER'; name: string; personId: string };

/** The central admin, or (when allowed) a leader of an assembly the person belongs to. */
export async function mayReadFaith(viewer: FaithViewer, targetPersonId: string): Promise<boolean> {
  if (viewer.kind === 'ADMIN') return true;
  if (!(await leadersMaySee())) return false;
  if (viewer.personId === targetPersonId) return false;
  return (await leaderPersonIdsOf(targetPersonId)).includes(viewer.personId);
}

/** Whether this member session is the central admin or a leader at all (the switch is checked per person). */
export async function viewerFromMember(personId: string, name: string): Promise<FaithViewer | null> {
  if (await isCentralAdminPerson(personId)) return { kind: 'ADMIN', name, personId };
  const leads = await prisma.roleAssignment.findFirst({ where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { id: true } });
  return leads ? { kind: 'LEADER', name, personId } : null;
}

// ----------------------------- Reading --------------------------------------

export async function faithJourney(personId: string) {
  const [person, record, notes, answers] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { id: true, name: true, whatsappNumber: true } }),
    prisma.faithRecord.findUnique({ where: { personId } }),
    prisma.faithNote.findMany({ where: { personId }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.personalAnswer.findMany({
      where: { personId },
      orderBy: [{ createdAt: 'asc' }, { order: 'asc' }],
      include: { attempt: { select: { id: true, attemptNumber: true, submittedAt: true, score: true, maxScore: true, percentage: true, passed: true, assessment: { select: { trainingBook: { select: { trainingOrder: true, titleEn: true, titleFr: true } } } } } } },
    }),
  ]);
  if (!person) return null;
  const tries = new Map<string, { attemptId: string; answeredAt: Date; attemptNumber: number; setNumber: number; score: number | null; maxScore: number | null; passed: boolean | null; book: { number: number | null; titleEn: string | null; titleFr: string | null }; answers: typeof answers }>();
  for (const a of answers) {
    let t = tries.get(a.attemptId);
    if (!t) {
      const book = a.attempt.assessment.trainingBook;
      t = {
        attemptId: a.attemptId,
        answeredAt: a.attempt.submittedAt ?? a.createdAt,
        attemptNumber: a.attempt.attemptNumber,
        setNumber: a.setNumber,
        score: a.attempt.score,
        maxScore: a.attempt.maxScore,
        passed: a.attempt.passed,
        book: { number: book?.trainingOrder ?? null, titleEn: book?.titleEn ?? null, titleFr: book?.titleFr ?? null },
        answers: [],
      };
      tries.set(a.attemptId, t);
    }
    t.answers.push(a);
  }
  return {
    person: { id: person.id, name: person.name, whatsappNumber: person.whatsappNumber },
    status: record?.status ?? null,
    lastAnsweredAt: record?.lastAnsweredAt ?? null,
    confirmedAt: record?.confirmedAt ?? null,
    confirmedByName: record?.confirmedByName ?? null,
    notes: notes.map((n) => ({ id: n.id, authorName: n.authorName, text: n.text, createdAt: n.createdAt })),
    tries: [...tries.values()]
      .sort((x, y) => y.answeredAt.getTime() - x.answeredAt.getTime())
      .map((t) => ({
        attemptId: t.attemptId,
        answeredAt: t.answeredAt,
        book: t.book,
        setNumber: t.setNumber,
        attemptNumber: t.attemptNumber,
        score: t.score,
        maxScore: t.maxScore,
        passed: t.passed,
        answers: t.answers.map((a) => ({
          order: a.order,
          signal: a.signal,
          questionEn: a.questionEn,
          questionFr: a.questionFr,
          answerEn: a.answerEn,
          answerFr: a.answerFr,
          guideEn: a.guideEn,
          guideFr: a.guideFr,
        })),
      })),
  };
}

export type FaithFilter = 'ALL' | 'NEEDS' | 'FOLLOW_UP' | 'BORN_AGAIN' | 'CONFIRMED';

/** The people who have answered, for the central admin (all of them) or a leader (those of their assemblies). */
export async function listFaith(viewer: FaithViewer, opts: { filter: FaithFilter; search?: string; limit?: number }) {
  let personIds: string[] | null = null;
  if (viewer.kind === 'LEADER') {
    if (!(await leadersMaySee())) return [];
    const mine = await prisma.roleAssignment.findMany({ where: { personId: viewer.personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } }, select: { communityId: true } });
    const members = await prisma.communityMembership.findMany({
      where: { status: 'ACTIVE', communityId: { in: mine.map((m) => m.communityId!) }, personId: { not: viewer.personId } },
      select: { personId: true },
    });
    personIds = [...new Set(members.map((m) => m.personId))];
    if (personIds.length === 0) return [];
  }
  const rows = await prisma.faithRecord.findMany({
    where: {
      ...(personIds ? { personId: { in: personIds } } : {}),
      ...(opts.filter === 'NEEDS' ? { status: 'NEEDS_CONVERSATION', confirmedAt: null } : {}),
      ...(opts.filter === 'BORN_AGAIN' ? { status: 'BORN_AGAIN' } : {}),
      ...(opts.filter === 'CONFIRMED' ? { confirmedAt: { not: null } } : {}),
      ...(opts.search?.trim() ? { person: { name: { contains: opts.search.trim(), mode: 'insensitive' as const } } } : {}),
    },
    orderBy: [{ lastAnsweredAt: 'desc' }],
    take: opts.filter === 'FOLLOW_UP' ? 200 : Math.min(opts.limit ?? 100, 200),
    include: { person: { select: { id: true, name: true } } },
  });
  // How many answers of their latest try call for a conversation (baptism not yet, the Holy Spirit not yet...),
  // even for someone whose status is "born again".
  const attemptIds = rows.map((r) => r.lastAttemptId).filter((id): id is string => Boolean(id));
  const flaggedBy = new Map<string, number>();
  if (attemptIds.length) {
    const grouped = await prisma.personalAnswer.groupBy({ by: ['attemptId'], where: { attemptId: { in: attemptIds }, signal: 'NEEDS_TALK' }, _count: { _all: true } });
    for (const g of grouped) flaggedBy.set(g.attemptId, g._count._all);
  }
  const items = rows.map((r) => ({
    personId: r.personId,
    name: r.person.name,
    status: r.status,
    lastAnsweredAt: r.lastAnsweredAt,
    confirmedAt: r.confirmedAt,
    confirmedByName: r.confirmedByName,
    flagged: r.lastAttemptId ? (flaggedBy.get(r.lastAttemptId) ?? 0) : 0,
  }));
  return opts.filter === 'FOLLOW_UP' ? items.filter((i) => i.flagged > 0 && !i.confirmedAt).slice(0, Math.min(opts.limit ?? 100, 200)) : items;
}

export async function setConfirmed(personId: string, viewer: FaithViewer, confirmed: boolean) {
  const record = await prisma.faithRecord.findUnique({ where: { personId }, select: { personId: true } });
  if (!record) return false;
  await prisma.faithRecord.update({
    where: { personId },
    data: confirmed ? { confirmedAt: new Date(), confirmedByName: viewer.name } : { confirmedAt: null, confirmedByName: null },
  });
  return true;
}

export async function addNote(personId: string, viewer: FaithViewer, text: string) {
  return prisma.faithNote.create({ data: { personId, authorPersonId: viewer.personId, authorName: viewer.name, text: text.trim().slice(0, 4000) } });
}
