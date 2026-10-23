import type { TranslationRetry } from '@prisma/client';
import { prisma } from './prisma';
import {
  attemptMessageAudioTranscription,
  attemptMessageTranslation,
  attemptUpdatePostTranslation,
  isTranslationConfigured,
  type TranslationOutcome,
} from './translation';

// Later retries for translations whose first attempt failed (queued by
// translation.ts as TranslationRetry rows). Each item is still translated
// at most once: a retry first re-reads the item and drops the row if it was
// deleted or has since been translated, and a successful retry deletes it.
//
// Schedule: the first retry 5 min after the failure (FIRST_RETRY_DELAY_MS
// in translation.ts), then 15 min, then 1 hour, then give up — at most 3
// extra Gemini requests per item, each a single try (no immediate re-try),
// to protect the free daily allowance.
export const RETRY_DELAYS_AFTER_MS = [15 * 60 * 1000, 60 * 60 * 1000];
export const MAX_RETRIES = 3;
const BATCH_SIZE = 5;
// Longer than one attempt can take (audio download + a 60s Gemini call), so
// a claimed row isn't picked up again while it's still being worked on.
const CLAIM_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;

async function runOne(job: TranslationRetry): Promise<TranslationOutcome> {
  if (job.kind === 'UPDATE_POST') {
    const post = await prisma.updatePost.findUnique({ where: { id: job.targetId } });
    if (!post || post.deletedAt || post.translatedAt) return 'skip';
    return attemptUpdatePostTranslation(post.id, post.body, { attempts: 1 });
  }
  const message = await prisma.message.findUnique({
    where: { id: job.targetId },
    include: { attachments: { select: { storageKey: true, mimeType: true } } },
  });
  if (!message || message.deletedAt) return 'skip';
  if (job.kind === 'MESSAGE_TEXT') {
    if (message.translatedAt || !message.body) return 'skip';
    return attemptMessageTranslation(message.id, message.body, { attempts: 1 });
  }
  if (message.transcribedAt) return 'skip';
  const audio = message.attachments.find((a) => a.mimeType.startsWith('audio/'));
  if (!audio) return 'skip';
  return attemptMessageAudioTranscription(message.id, audio.storageKey, audio.mimeType, { attempts: 1 });
}

/** Runs every due retry (up to BATCH_SIZE per call). Safe to run on several
 * servers at once: a row is only worked on by the server whose conditional
 * update claimed it. */
export async function processDueTranslationRetries(now: Date = new Date()): Promise<void> {
  if (!isTranslationConfigured()) return;
  const unclaimed = { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] };
  const due = await prisma.translationRetry.findMany({
    where: { nextAttemptAt: { lte: now }, ...unclaimed },
    orderBy: { nextAttemptAt: 'asc' },
    take: BATCH_SIZE,
  });
  for (const job of due) {
    const claimed = await prisma.translationRetry.updateMany({
      where: { id: job.id, ...unclaimed },
      data: { lockedUntil: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count !== 1) continue;

    const outcome = await runOne(job).catch(() => 'retry' as const);
    const retriesMade = job.attempts + 1;
    if (outcome !== 'retry') {
      await prisma.translationRetry.delete({ where: { id: job.id } }).catch(() => {});
    } else if (retriesMade >= MAX_RETRIES) {
      console.warn('[translation] giving up after retries', { kind: job.kind, targetId: job.targetId, retries: retriesMade });
      await prisma.translationRetry.delete({ where: { id: job.id } }).catch(() => {});
    } else {
      await prisma.translationRetry
        .update({
          where: { id: job.id },
          data: {
            attempts: retriesMade,
            nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_AFTER_MS[retriesMade - 1]),
            lockedUntil: null,
          },
        })
        .catch(() => {});
    }
  }
}

/** Checks for due retries once a minute for the life of the process. A
 * tick never overlaps the previous one, and never throws. */
export function startTranslationRetryLoop(): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processDueTranslationRetries()
      .catch((err) => {
        console.error('[translation] retry tick failed', { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        running = false;
      });
  }, TICK_MS);
  timer.unref();
}
