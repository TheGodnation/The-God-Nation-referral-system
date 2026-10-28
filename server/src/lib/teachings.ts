import { prisma } from './prisma';
import { profilePhotoPath } from './profilePhoto';

// ---------------------------------------------------------------------------
// Teachings — see the Teaching model in schema.prisma. The system, not the
// member, decides who has "read / listened": the app reports what it saw
// (scrolled to the end of the text, how much of the audio/video really
// played, the PDF's last page reached) and this file keeps the best result,
// approves the member (completedAt) once every part is done, and opens the
// quiz only then.
// ---------------------------------------------------------------------------

/** Share of an audio/video that must really have played. */
export const REQUIRED_MEDIA_FRACTION = 0.9;
export const DEFAULT_OPEN_DAYS = 7;
export const MAX_RESULTS_SHOWN = 500;

export type TeachingMediaKind = 'AUDIO' | 'VIDEO' | 'PDF';

export function mediaKindOf(mimeType: string): TeachingMediaKind | null {
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType === 'application/pdf') return 'PDF';
  return null;
}

/**
 * The least time (seconds) a written teaching must have been open before
 * "read to the end" counts: about twice reading speed, at most 90 seconds,
 * so scrolling straight to the bottom doesn't count as reading.
 */
export function minReadSeconds(text: string | null): number {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(5, Math.min(90, Math.round(words / 6)));
}

export interface ProgressInput {
  /** The text was scrolled to the end. */
  textRead?: boolean;
  /** Share (0..1) of the audio/video that really played; 1 for a PDF whose last page was reached. */
  mediaFraction?: number;
}

interface TeachingParts {
  id: string;
  text: string | null;
  mediaKind: string | null;
}

/** Records what a member has seen so far (never goes backwards) and approves them once everything is done. */
export async function recordProgress(teaching: TeachingParts, personId: string, input: ProgressInput, now = new Date()) {
  const hasText = Boolean(teaching.text && teaching.text.trim());
  const hasMedia = Boolean(teaching.mediaKind);
  const row = await prisma.teachingProgress.upsert({
    where: { teachingId_personId: { teachingId: teaching.id, personId } },
    create: { teachingId: teaching.id, personId, openedAt: now },
    update: {},
  });

  let textReadAt = row.textReadAt;
  if (input.textRead && hasText && !textReadAt) {
    const openFor = (now.getTime() - row.openedAt.getTime()) / 1000;
    if (openFor >= minReadSeconds(teaching.text)) textReadAt = now;
  }

  let mediaFraction = row.mediaFraction;
  if (hasMedia && typeof input.mediaFraction === 'number' && Number.isFinite(input.mediaFraction)) {
    mediaFraction = Math.max(mediaFraction, Math.min(1, Math.max(0, input.mediaFraction)));
  }
  const mediaDoneAt = row.mediaDoneAt ?? (hasMedia && mediaFraction >= REQUIRED_MEDIA_FRACTION ? now : null);

  const textDone = !hasText || Boolean(textReadAt);
  const mediaDone = !hasMedia || Boolean(mediaDoneAt);
  const completedAt = row.completedAt ?? (textDone && mediaDone ? now : null);

  return prisma.teachingProgress.update({
    where: { id: row.id },
    data: { textReadAt, mediaFraction, mediaDoneAt, completedAt },
  });
}

export type QuizState = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'DONE' | 'CLOSED';

export interface MyQuiz {
  state: QuizState;
  percentage: number | null;
  passed: boolean | null;
}

/** Where this member is with the quiz: locked until approved, then open until the teaching's closing day. */
export function quizStateOf(
  teaching: { closesAt: Date },
  progress: { completedAt: Date | null } | null,
  attempts: { status: string; percentage: number | null; passed: boolean | null }[],
  now = new Date(),
): MyQuiz {
  const submitted = attempts.find((a) => a.status === 'SUBMITTED');
  if (submitted) return { state: 'DONE', percentage: submitted.percentage, passed: submitted.passed };
  if (!progress?.completedAt) return { state: now > teaching.closesAt ? 'CLOSED' : 'LOCKED', percentage: null, passed: null };
  if (now > teaching.closesAt) return { state: 'CLOSED', percentage: null, passed: null };
  if (attempts.some((a) => a.status === 'IN_PROGRESS')) return { state: 'IN_PROGRESS', percentage: null, passed: null };
  return { state: 'AVAILABLE', percentage: null, passed: null };
}

export type CardState = 'NEW' | 'STARTED' | 'FINISHED' | 'PASSED' | 'FAILED';

/** What the teaching's card in the chat says about the viewer, for a page of messages at once. */
export async function cardStatesFor(personId: string, teachings: { id: string; assessmentId: string }[]) {
  const result = new Map<string, { state: CardState; percentage: number | null }>();
  if (teachings.length === 0) return result;
  const [progress, attempts] = await Promise.all([
    prisma.teachingProgress.findMany({ where: { personId, teachingId: { in: teachings.map((t) => t.id) } }, select: { teachingId: true, completedAt: true } }),
    prisma.attempt.findMany({
      where: { personId, status: 'SUBMITTED', assessmentId: { in: teachings.map((t) => t.assessmentId) } },
      orderBy: { attemptNumber: 'asc' },
      select: { assessmentId: true, percentage: true, passed: true },
    }),
  ]);
  for (const t of teachings) {
    const p = progress.find((x) => x.teachingId === t.id);
    const a = attempts.find((x) => x.assessmentId === t.assessmentId);
    if (a) result.set(t.id, { state: a.passed ? 'PASSED' : 'FAILED', percentage: a.percentage });
    else if (p?.completedAt) result.set(t.id, { state: 'FINISHED', percentage: null });
    else if (p) result.set(t.id, { state: 'STARTED', percentage: null });
    else result.set(t.id, { state: 'NEW', percentage: null });
  }
  return result;
}

export interface CardTotals {
  members: number;
  finished: number;
  taken: number;
  passed: number;
  /** The best first-try scores (highest first), for the card. */
  top: { name: string; percentage: number; passed: boolean }[];
}

const CARD_TOP_SHOWN = 5;

/** The assembly-wide numbers on each teaching's card (the author is never counted; only a person's first try). */
export async function cardTotalsFor(teachings: { id: string; communityId: string; assessmentId: string; authorPersonId: string | null }[]) {
  const result = new Map<string, CardTotals>();
  if (teachings.length === 0) return result;
  const [progress, attempts, members] = await Promise.all([
    prisma.teachingProgress.findMany({
      where: { teachingId: { in: teachings.map((t) => t.id) }, completedAt: { not: null } },
      select: { teachingId: true, personId: true },
    }),
    prisma.attempt.findMany({
      where: { status: 'SUBMITTED', assessmentId: { in: teachings.map((t) => t.assessmentId) } },
      orderBy: { attemptNumber: 'asc' },
      select: { assessmentId: true, personId: true, passed: true, percentage: true, person: { select: { name: true } } },
    }),
    Promise.all(
      teachings.map((t) =>
        prisma.communityMembership.count({
          where: { communityId: t.communityId, status: 'ACTIVE', ...(t.authorPersonId ? { personId: { not: t.authorPersonId } } : {}) },
        }),
      ),
    ),
  ]);
  for (const t of teachings) {
    const firstTry = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) if (a.assessmentId === t.assessmentId && a.personId !== t.authorPersonId && !firstTry.has(a.personId)) firstTry.set(a.personId, a);
    result.set(t.id, {
      members: members[teachings.indexOf(t)],
      finished: progress.filter((p) => p.teachingId === t.id && p.personId !== t.authorPersonId).length,
      taken: firstTry.size,
      passed: [...firstTry.values()].filter((a) => a.passed).length,
      top: [...firstTry.values()]
        .filter((a) => a.percentage !== null)
        .sort((x, y) => y.percentage! - x.percentage! || x.person.name.localeCompare(y.person.name))
        .slice(0, CARD_TOP_SHOWN)
        .map((a) => ({ name: a.person.name, percentage: Math.round(a.percentage!), passed: Boolean(a.passed) })),
    });
  }
  return result;
}

export interface TeachingResults {
  totals: { members: number; opened: number; finished: number; taken: number; passed: number; averagePercentage: number | null };
  participants: {
    personId: string;
    name: string;
    photoUrl: string | null;
    finishedAt: string | null;
    percentage: number | null;
    passed: boolean | null;
    takenAt: string | null;
  }[];
  /** For the central admin only: members who have not finished yet. */
  /** Everyone in the assembly who has not finished yet — shown to all members. */
  notFinished?: { personId: string; name: string; photoUrl: string | null }[];
}

/**
 * The list everyone in the assembly sees, built live from what the system
 * recorded: who has finished reading / listening and each person's quiz
 * score. The author is never counted. The central admin also gets the names
 * of those who haven't finished.
 */
export async function teachingResults(
  teaching: { id: string; communityId: string; assessmentId: string; authorPersonId: string | null },
  canManage: boolean,
): Promise<TeachingResults> {
  const notAuthor = teaching.authorPersonId ? { personId: { not: teaching.authorPersonId } } : {};
  const [members, progress, attempts] = await Promise.all([
    prisma.communityMembership.findMany({
      where: { communityId: teaching.communityId, status: 'ACTIVE', ...notAuthor },
      select: { person: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
    }),
    prisma.teachingProgress.findMany({
      where: { teachingId: teaching.id, ...notAuthor },
      include: { person: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
    }),
    prisma.attempt.findMany({
      where: { assessmentId: teaching.assessmentId, status: 'SUBMITTED', ...notAuthor },
      orderBy: { attemptNumber: 'asc' },
      select: { personId: true, percentage: true, passed: true, submittedAt: true },
    }),
  ]);

  // Only a person's first try counts.
  const firstTry = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) if (!firstTry.has(a.personId)) firstTry.set(a.personId, a);

  const rows = new Map<string, TeachingResults['participants'][number]>();
  for (const p of progress) {
    if (!p.completedAt && !firstTry.has(p.personId)) continue;
    const a = firstTry.get(p.personId);
    rows.set(p.personId, {
      personId: p.personId,
      name: p.person.name,
      photoUrl: profilePhotoPath(p.person),
      finishedAt: p.completedAt?.toISOString() ?? null,
      percentage: a?.percentage ?? null,
      passed: a?.passed ?? null,
      takenAt: a?.submittedAt?.toISOString() ?? null,
    });
  }
  const participants = [...rows.values()]
    .sort((x, y) => {
      if ((x.percentage === null) !== (y.percentage === null)) return x.percentage === null ? 1 : -1;
      if (x.percentage !== null && y.percentage !== null && x.percentage !== y.percentage) return y.percentage - x.percentage;
      return (x.takenAt ?? x.finishedAt ?? '').localeCompare(y.takenAt ?? y.finishedAt ?? '');
    })
    .slice(0, MAX_RESULTS_SHOWN);

  const scores = [...firstTry.values()].map((a) => a.percentage).filter((v): v is number => v !== null);
  const totals = {
    members: members.length,
    opened: progress.length,
    finished: progress.filter((p) => p.completedAt).length,
    taken: firstTry.size,
    passed: [...firstTry.values()].filter((a) => a.passed).length,
    averagePercentage: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
  };

  // Everyone in the assembly sees who is still pending (a gentle nudge for all).
  const finished = new Set(progress.filter((p) => p.completedAt).map((p) => p.personId));
  const notFinished = members
    .filter((m) => !finished.has(m.person.id))
    .map((m) => ({ personId: m.person.id, name: m.person.name, photoUrl: profilePhotoPath(m.person) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_RESULTS_SHOWN);
  const out: TeachingResults = { totals, participants, notFinished };
  return out;
}
