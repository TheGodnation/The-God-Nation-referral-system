import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getObjectStream } from './storage';
import { draftQuizQuestions, isQuizDraftingAvailable } from './teachingQuiz';

// A teaching's quiz gets ONE retake. After failing the first try, the member
// can try again straight away, with a fresh set of questions about the same
// teaching (never the ones they have already seen). Fail again and that is
// final. The fresh set is written once by the AI and shared by everyone who
// retakes; it lives in the same quiz as question set 2 (the first try's
// questions are set 1).

export const RETAKE_SET = 2;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export type RetakeState = 'AVAILABLE' | 'USED' | null;

/** Where a member stands on the retake, from their tries at this quiz (oldest first). */
export function retakeStateOf(attempts: { status: string; passed: boolean | null }[]): RetakeState {
  const first = attempts[0];
  if (!first || first.status !== 'SUBMITTED' || first.passed) return null;
  return attempts.length >= 2 ? 'USED' : 'AVAILABLE';
}

export class RetakeError extends Error {
  constructor(
    public status: number,
    public code: 'NOT_ALLOWED' | 'NO_SOURCE' | 'AI_OFF' | 'AI_FAILED' | 'RACE',
    message: string,
  ) {
    super(message);
  }
}

async function readAudioBase64(storageKey: string): Promise<string | null> {
  const obj = await getObjectStream({ storageKey }).catch(() => null);
  if (!obj) return null;
  if (obj.contentLength && obj.contentLength > MAX_AUDIO_BYTES) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of obj.body as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_AUDIO_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('base64');
}

const preparing = new Map<string, Promise<void>>();

/**
 * Makes sure the fresh question set exists (writing it with the AI the first
 * time it is needed). Throws a RetakeError when it cannot be prepared now.
 */
export function ensureRetakeQuestions(teaching: { id: string; assessmentId: string; text: string | null; messageId: string }): Promise<void> {
  const running = preparing.get(teaching.assessmentId);
  if (running) return running;
  const job = prepare(teaching).finally(() => preparing.delete(teaching.assessmentId));
  preparing.set(teaching.assessmentId, job);
  return job;
}

async function prepare(teaching: { id: string; assessmentId: string; text: string | null; messageId: string }): Promise<void> {
  if (await prisma.question.count({ where: { assessmentId: teaching.assessmentId, setNumber: RETAKE_SET } })) return;
  if (!isQuizDraftingAvailable()) throw new RetakeError(503, 'AI_OFF', 'New questions cannot be prepared right now.');

  const original = await prisma.question.findMany({ where: { assessmentId: teaching.assessmentId, setNumber: 1 }, select: { textEn: true, textFr: true } });
  const message = await prisma.message.findUnique({
    where: { id: teaching.messageId },
    select: { transcribedBody: true, attachments: { select: { storageKey: true, mimeType: true } } },
  });
  // What the questions are written from: the text, else what was said in the audio.
  let text = teaching.text?.trim() || message?.transcribedBody?.trim() || null;
  let audio: { base64: string; mimeType: string } | null = null;
  if (!text) {
    const voice = message?.attachments.find((a) => a.mimeType.startsWith('audio/'));
    const base64 = voice ? await readAudioBase64(voice.storageKey) : null;
    if (voice && base64) audio = { base64, mimeType: voice.mimeType };
  }
  if (!text && !audio) {
    throw new RetakeError(503, 'NO_SOURCE', 'New questions cannot be prepared for this teaching (it has no text or audio to ask about).');
  }

  const drafted = await draftQuizQuestions({
    text,
    audio,
    count: Math.min(10, Math.max(5, original.length)),
    avoid: original.flatMap((q) => [q.textEn, ...(q.textFr ? [q.textFr] : [])]),
  });
  if (!drafted) throw new RetakeError(502, 'AI_FAILED', 'New questions could not be prepared just now. Please try again in a moment.');

  await prisma.$transaction(async (tx) => {
    // One writer at a time; whoever is second finds the set already there.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teaching.assessmentId}))`;
    if (await tx.question.count({ where: { assessmentId: teaching.assessmentId, setNumber: RETAKE_SET } })) return;
    for (const [qi, q] of drafted.entries()) {
      await tx.question.create({
        data: {
          assessmentId: teaching.assessmentId,
          setNumber: RETAKE_SET,
          textEn: q.textEn,
          textFr: q.textFr,
          order: qi,
          options: { create: q.options.map((o, oi) => ({ textEn: o.textEn, textFr: o.textFr, isCorrect: oi === q.correctIndex, order: oi })) },
        },
      });
    }
  });
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Starts the member's one retake: the fresh questions, shuffled, as an unfinished second try. */
export async function startTeachingRetake(personId: string, teaching: { id: string; assessmentId: string; text: string | null; messageId: string }) {
  const attempts = await prisma.attempt.findMany({ where: { personId, assessmentId: teaching.assessmentId }, orderBy: { attemptNumber: 'asc' }, select: { status: true, passed: true, id: true } });
  // A retake already begun: carry on with it.
  const open = attempts.length === 2 && attempts[1].status === 'IN_PROGRESS' && attempts[0].passed === false ? attempts[1] : null;
  if (open) return prisma.attempt.findUniqueOrThrow({ where: { id: open.id } });
  if (retakeStateOf(attempts) !== 'AVAILABLE') throw new RetakeError(409, 'NOT_ALLOWED', 'There is no retake to take for this quiz.');

  await ensureRetakeQuestions(teaching);
  const questions = await prisma.question.findMany({ where: { assessmentId: teaching.assessmentId, setNumber: RETAKE_SET }, select: { id: true } });
  try {
    return await prisma.attempt.create({
      data: { personId, assessmentId: teaching.assessmentId, attemptNumber: 2, setNumber: RETAKE_SET, questionOrder: shuffled(questions.map((q) => q.id)) },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new RetakeError(409, 'RACE', 'Your retake was already started. Please try again.');
    throw err;
  }
}

/** Members who failed their first try and have not retaken yet. */
export async function membersWhoCanRetake(assessmentId: string, excludePersonId: string | null): Promise<string[]> {
  const attempts = await prisma.attempt.findMany({
    where: { assessmentId, ...(excludePersonId ? { personId: { not: excludePersonId } } : {}) },
    orderBy: [{ personId: 'asc' }, { attemptNumber: 'asc' }],
    select: { personId: true, status: true, passed: true },
  });
  const byPerson = new Map<string, { status: string; passed: boolean | null }[]>();
  for (const a of attempts) byPerson.set(a.personId, [...(byPerson.get(a.personId) ?? []), a]);
  return [...byPerson.entries()].filter(([, list]) => retakeStateOf(list) === 'AVAILABLE').map(([personId]) => personId);
}
