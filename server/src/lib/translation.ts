import type { Language, TranslationRetryKind } from '@prisma/client';
import { prisma } from './prisma';
import { getObjectStream } from './storage';

// Auto-translation (Gemini) — text translation on Updates posts, teachings
// (title, text and quiz) and Community group-chat messages, and voice-note transcription+translation in
// group chat. Never PrivateMessage, never Prayer Requests — those features
// never call into this file at all, which is what actually keeps that
// content from ever being sent to Gemini (not a flag or a check here).
//
// Same "best-effort, never throw into the request that triggered it, and
// the app behaves identically whether or not configured" rule as push.ts's
// own VAPID keys: every function here degrades to returning null on any
// failure (missing key, network error, malformed response), and callers
// must already handle "no translation yet" today (it's also the state
// every row is in for the first moment after it's created).
//
// The app only has two languages (en/fr), so there is only ever one
// translation to produce: whichever of the two a piece of text is NOT.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// A "-latest" alias rather than a dated model name: Google retires and
// restricts dated names often (gemini-2.0-flash and gemini-2.5-flash both
// 404ed here), and repoints the alias at whichever model is current. Lite
// rather than full Flash because this key is on Gemini's free tier, where
// full Flash allows only 20 requests a day ("limit: 20" in its 429) and
// Flash-Lite allows far more. If it ever 404s, logAvailableModels below
// logs the real options straight from Gemini.
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEXT_TIMEOUT_MS = 30000;
// Translating a long post (texts can now be up to 65,536 characters) takes
// Gemini much longer than a few lines: 20s cut longer French posts off, so
// nothing was translated. Allow more time the longer the text, up to 3 min.
// It all runs in the background, so nobody waits on it.
const MAX_TEXT_TIMEOUT_MS = 180000;
export function textTimeoutMs(text: string): number {
  return Math.min(MAX_TEXT_TIMEOUT_MS, TEXT_TIMEOUT_MS + Math.ceil(text.length / 100) * 1000);
}
// Transcribing audio takes Gemini far longer than translating a few lines
// of text; 20s cut longer voice notes off mid-transcription.
const AUDIO_TIMEOUT_MS = 60000;
// Gemini occasionally answers 503 "This model is currently experiencing
// high demand" — a transient capacity issue on Google's side, not a bug
// here. One short-delay retry absorbs that without ever doubling the
// user-visible latency on an outright failure.
const RETRY_DELAY_MS = 1500;
const DEFAULT_ATTEMPTS = 2;

export interface GeminiCallOptions {
  /** Immediate tries for this one call (the later, spaced-out retries in
   * translationRetry.ts pass 1 — they are already the "try again"). */
  attempts?: number;
  timeoutMs?: number;
}

/** What one try at translating/transcribing an item came to:
 * - done: stored (or nothing left to do for it);
 * - retry: failed in a way that may succeed later (timeout, network,
 *   Gemini overloaded or quota reached) — worth queuing a retry;
 * - skip: can never succeed (not configured, nothing to translate, file
 *   missing or too large) — don't queue anything. */
export type TranslationOutcome = 'done' | 'retry' | 'skip';

export function isTranslationConfigured(): boolean {
  return Boolean(GEMINI_API_KEY);
}

let warnedUnconfigured = false;

// A conservative cutoff for inline audio (base64 adds ~33% to the raw
// byte size) — comfortably under Gemini's inline-request size limit. A
// voice note larger than this (attachmentPolicy.ts already caps audio at
// 20MB) simply never gets transcribed — a safe, silent degrade, same as
// any other failure here.
const MAX_INLINE_AUDIO_BYTES = 15 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs JSON to Gemini with a per-attempt timeout, retrying once (after a
 * short delay) on a 503 "high demand" response or a thrown network/timeout
 * error. Returns whatever the final attempt produced — callers still handle
 * a non-OK response or a thrown error exactly as before, retry or not.
 */
async function postGeminiJson(url: string, body: unknown, opts: GeminiCallOptions = {}): Promise<Response> {
  const maxAttempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? TEXT_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 503 && attempt < maxAttempts) {
        console.warn('[translation] Gemini reported high demand (503) — retrying once', { attempt });
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn('[translation] Gemini call failed — retrying once', { attempt, error: err instanceof Error ? err.message : String(err) });
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function callGemini(contents: unknown[], schema: unknown, opts: GeminiCallOptions = {}): Promise<any | null> {
  if (!GEMINI_API_KEY) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[translation] GEMINI_API_KEY not configured — translation/transcription disabled');
    }
    return null;
  }
  try {
    const res = await postGeminiJson(`${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      contents,
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }, opts);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error('[translation] Gemini responded with a non-OK status', { status: res.status, body: bodyText.slice(0, 500) });
      if (res.status === 404) {
        void logAvailableModels();
      }
      return null;
    }
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      console.error('[translation] Gemini response had no text part', { data: JSON.stringify(data).slice(0, 500) });
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      console.error('[translation] could not parse Gemini\'s JSON text', { text: text.slice(0, 500), error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  } catch (err) {
    console.error('[translation] Gemini call threw', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function isLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'fr';
}

const textSchema = {
  type: 'object',
  properties: {
    detectedLanguage: { type: 'string', enum: ['en', 'fr'] },
    translated: { type: 'string' },
  },
  required: ['detectedLanguage', 'translated'],
};

export interface TextTranslationResult {
  detectedLanguage: Language;
  translatedBody: string;
}

/**
 * Detects whether `text` is English or French and translates it into
 * whichever of the two it is NOT. Returns null if translation is not
 * configured, the text is empty, or the call fails for any reason.
 */
export async function translateText(text: string, opts: GeminiCallOptions = {}): Promise<TextTranslationResult | null> {
  if (!text.trim()) return null;
  const prompt =
    'Detect whether the following message is written in English or French, then translate it into ' +
    'the other of those two languages. Keep the tone, emoji and meaning natural. The message may use ' +
    'formatting symbols: *bold*, _italic_, ~strikethrough~, and lines starting with "- ", "1. ", "> " or ' +
    '"# ". Keep every symbol exactly where it belongs around the translated words, keep line breaks, ' +
    'and never translate or change web addresses. Reply with the translation only, no commentary.\n\nMessage:\n"""' +
    text +
    '"""';
  const result = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], textSchema, { timeoutMs: textTimeoutMs(text), ...opts });
  if (!result || !isLanguage(result.detectedLanguage) || typeof result.translated !== 'string') return null;
  return { detectedLanguage: result.detectedLanguage, translatedBody: result.translated };
}

const teachingSchema = {
  type: 'object',
  properties: {
    detectedLanguage: { type: 'string', enum: ['en', 'fr'] },
    title: { type: 'string' },
    text: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
        required: ['text', 'options'],
      },
    },
  },
  required: ['detectedLanguage', 'title', 'text', 'questions'],
};

export interface TeachingTranslationInput {
  title: string;
  text: string | null;
  questions: { text: string; options: string[] }[];
}

export interface TeachingTranslationResult {
  detectedLanguage: Language;
  title: string;
  text: string | null;
  questions: { text: string; options: string[] }[];
}

/**
 * Detects whether a teaching is written in English or French and translates
 * its title, text and quiz into the other one — a single Gemini call so the
 * whole teaching costs one request. Returns null on any failure, or when the
 * answer doesn't line up with what was sent (a wrong count of questions or
 * answers would put the wrong words on the wrong answer).
 */
export async function translateTeaching(input: TeachingTranslationInput, opts: GeminiCallOptions = {}): Promise<TeachingTranslationResult | null> {
  const payload = JSON.stringify({ title: input.title, text: input.text ?? '', questions: input.questions });
  const prompt =
    'Below is a teaching from a church community, as JSON: a title, a written text (may be empty) and quiz ' +
    'questions each with their answer choices. Detect whether it is written in English or French, then ' +
    'translate everything into the other of those two languages. Keep the meaning, tone and any Bible ' +
    'references natural (use the usual book names of the target language). The text may use formatting ' +
    'symbols: *bold*, _italic_, ~strikethrough~, and lines starting with "- ", "1. ", "> " or "# ". Keep every ' +
    'symbol exactly where it belongs around the translated words, keep line breaks, and never translate or ' +
    'change web addresses. Return the same structure: the same number of questions, in the same order, ' +
    'each with the same number of answer choices in the same order. Empty text stays empty. Reply with ' +
    'the translation only, no commentary.\n\nTeaching:\n"""' +
    payload +
    '"""';
  const result = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], teachingSchema, { timeoutMs: textTimeoutMs(payload), ...opts });
  if (!result || !isLanguage(result.detectedLanguage) || typeof result.title !== 'string' || typeof result.text !== 'string') return null;
  const questions: unknown = result.questions;
  if (!Array.isArray(questions) || questions.length !== input.questions.length) return null;
  const out: { text: string; options: string[] }[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q: any = questions[i];
    if (!q || typeof q.text !== 'string' || !Array.isArray(q.options) || q.options.length !== input.questions[i].options.length) return null;
    if (!q.options.every((o: unknown) => typeof o === 'string')) return null;
    out.push({ text: q.text, options: q.options });
  }
  if (!result.title.trim()) return null;
  return { detectedLanguage: result.detectedLanguage, title: result.title, text: input.text?.trim() ? result.text : null, questions: out };
}

const audioSchema = {
  type: 'object',
  properties: {
    detectedLanguage: { type: 'string', enum: ['en', 'fr'] },
    transcript: { type: 'string' },
    translated: { type: 'string' },
  },
  required: ['detectedLanguage', 'transcript', 'translated'],
};

export interface AudioTranslationResult {
  detectedLanguage: Language;
  transcript: string;
  translatedTranscript: string;
}

/**
 * Transcribes a voice note and translates the transcript into whichever of
 * English/French it was NOT spoken in — one Gemini call, since Gemini
 * accepts audio input directly. Returns null on any failure (including an
 * audio file over MAX_INLINE_AUDIO_BYTES).
 */
export async function transcribeAndTranslateAudio(
  audioBase64: string,
  mimeType: string,
  opts: GeminiCallOptions = {},
): Promise<AudioTranslationResult | null> {
  // Rough check: base64 is ~4/3 the raw size.
  if (audioBase64.length * 0.75 > MAX_INLINE_AUDIO_BYTES) return null;
  const prompt =
    'Transcribe this voice message exactly as spoken. Detect whether it is English or French, and also ' +
    'translate the transcript into the other of those two languages.';
  const result = await callGemini(
    [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }] }],
    audioSchema,
    { timeoutMs: AUDIO_TIMEOUT_MS, ...opts },
  );
  if (!result || !isLanguage(result.detectedLanguage) || typeof result.transcript !== 'string' || typeof result.translated !== 'string') {
    return null;
  }
  return { detectedLanguage: result.detectedLanguage, transcript: result.transcript, translatedTranscript: result.translated };
}

let loggedAvailableModels = false;

/**
 * Calls Gemini's ListModels endpoint and logs every model whose
 * supportedGenerationMethods includes generateContent, so when Gemini 404s
 * on GEMINI_MODEL the real options can be read straight from production
 * logs instead of guessed. Best-effort and silent on its own failure.
 */
async function logAvailableModels(): Promise<void> {
  if (loggedAvailableModels) return;
  loggedAvailableModels = true;
  try {
    const res = await fetch(`${GEMINI_BASE_URL}?pageSize=200&key=${GEMINI_API_KEY}`);
    if (!res.ok) {
      console.error('[translation] ListModels responded with a non-OK status', { status: res.status });
      return;
    }
    const data: any = await res.json();
    const models: any[] = Array.isArray(data?.models) ? data.models : [];
    const generateContentModels = models
      .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => m.name);
    console.error('[translation] Gemini models supporting generateContent (looking for a real model name)', { generateContentModels });
  } catch (err) {
    console.error('[translation] ListModels call threw', { error: err instanceof Error ? err.message : String(err) });
  }
}

// The first retry is due this long after the first attempt fails; see
// translationRetry.ts for the rest of the schedule.
export const FIRST_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Queues an item for a later retry. Idempotent: an item already queued
 * keeps its place (one row per item, see TranslationRetry). */
export async function scheduleTranslationRetry(kind: TranslationRetryKind, targetId: string): Promise<void> {
  await prisma.translationRetry
    .upsert({
      where: { kind_targetId: { kind, targetId } },
      create: { kind, targetId, nextAttemptAt: new Date(Date.now() + FIRST_RETRY_DELAY_MS) },
      update: {},
    })
    .catch((err) => {
      console.error('[translation] could not queue a retry', { kind, targetId, error: err instanceof Error ? err.message : String(err) });
    });
}

async function storeOutcome(write: Promise<unknown>): Promise<TranslationOutcome> {
  return write.then(
    () => 'done' as const,
    // The item was deleted in the meantime (P2025) — nothing left to do.
    (err) => (err?.code === 'P2025' ? 'skip' : 'retry'),
  );
}

/** One try at translating an Updates post and storing the result. */
export async function attemptUpdatePostTranslation(postId: string, body: string, opts: GeminiCallOptions = {}): Promise<TranslationOutcome> {
  if (!isTranslationConfigured() || !body.trim()) return 'skip';
  const result = await translateText(body, opts);
  if (!result) return 'retry';
  return storeOutcome(
    prisma.updatePost.update({
      where: { id: postId },
      data: { detectedLanguage: result.detectedLanguage, translatedBody: result.translatedBody, translatedAt: new Date() },
    }),
  );
}

/** One try at translating a group-chat message and storing the result. */
export async function attemptMessageTranslation(messageId: string, body: string, opts: GeminiCallOptions = {}): Promise<TranslationOutcome> {
  if (!isTranslationConfigured() || !body.trim()) return 'skip';
  const result = await translateText(body, opts);
  if (!result) return 'retry';
  return storeOutcome(
    prisma.message.update({
      where: { id: messageId },
      data: { detectedLanguage: result.detectedLanguage, translatedBody: result.translatedBody, translatedAt: new Date() },
    }),
  );
}

/**
 * One try at translating a teaching: its title and text, plus every quiz
 * question or answer that doesn't have its other-language version yet. The
 * quiz columns are textEn/textFr: if the teaching is in French, what the
 * author typed (stored in textEn) moves to textFr and the English goes in
 * textEn, so members of either language read the quiz in their own.
 */
export async function attemptTeachingTranslation(teachingId: string, opts: GeminiCallOptions = {}): Promise<TranslationOutcome> {
  if (!isTranslationConfigured()) return 'skip';
  const teaching = await prisma.teaching.findUnique({
    where: { id: teachingId },
    include: {
      assessment: {
        select: {
          questions: {
            orderBy: { order: 'asc' },
            select: { id: true, textEn: true, textFr: true, options: { orderBy: { order: 'asc' }, select: { id: true, textEn: true, textFr: true } } },
          },
        },
      },
    },
  });
  if (!teaching || teaching.translatedAt) return 'skip';
  const questions = teaching.assessment.questions;
  const result = await translateTeaching(
    { title: teaching.title, text: teaching.text, questions: questions.map((q) => ({ text: q.textEn, options: q.options.map((o) => o.textEn) })) },
    opts,
  );
  if (!result) return 'retry';
  // Each quiz text is filled once; one the author already wrote in both
  // languages is left exactly as written.
  const french = result.detectedLanguage === 'fr';
  const fill = (written: string, other: string) => (french ? { textEn: other, textFr: written } : { textFr: other });
  return storeOutcome(
    prisma.$transaction([
      prisma.teaching.update({
        where: { id: teachingId },
        data: { detectedLanguage: result.detectedLanguage, titleTranslated: result.title, textTranslated: result.text, translatedAt: new Date() },
      }),
      // The chat card shows the title as the message's own text.
      prisma.message.updateMany({
        where: { id: teaching.messageId, translatedAt: null },
        data: { detectedLanguage: result.detectedLanguage, translatedBody: result.title, translatedAt: new Date() },
      }),
      ...questions.flatMap((q, qi) => [
        ...(q.textFr === null ? [prisma.question.update({ where: { id: q.id }, data: fill(q.textEn, result.questions[qi].text) })] : []),
        ...q.options.flatMap((o, oi) =>
          o.textFr === null ? [prisma.option.update({ where: { id: o.id }, data: fill(o.textEn, result.questions[qi].options[oi]) })] : [],
        ),
      ]),
    ]),
  );
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** One try at transcribing+translating a voice note and storing the
 * result. Downloads the object from storage server-side (never exposed to
 * the client). */
export async function attemptMessageAudioTranscription(
  messageId: string,
  storageKey: string,
  mimeType: string,
  opts: GeminiCallOptions = {},
): Promise<TranslationOutcome> {
  // Skip the storage download entirely when unconfigured — no point
  // fetching audio we can't transcribe. callGemini's own warning covers the
  // text-translation path; this one is separate since a pure voice note has
  // no body for that path to ever run.
  if (!isTranslationConfigured()) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[translation] GEMINI_API_KEY not configured — translation/transcription disabled');
    }
    return 'skip';
  }
  let readFailed = false;
  const object = await getObjectStream({ storageKey }).catch((err) => {
    readFailed = true;
    console.error('[translation] failed to read voice note from storage', { storageKey, error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (!object) return readFailed ? 'retry' : 'skip';
  if (object.contentLength && object.contentLength > MAX_INLINE_AUDIO_BYTES) {
    console.warn('[translation] voice note too large to transcribe inline', { storageKey, contentLength: object.contentLength });
    return 'skip';
  }
  const buffer = await streamToBuffer(object.body).catch(() => null);
  if (!buffer) return 'retry';
  const result = await transcribeAndTranslateAudio(buffer.toString('base64'), mimeType, opts);
  if (!result) return 'retry';
  return storeOutcome(
    prisma.message.update({
      where: { id: messageId },
      data: {
        transcribedLanguage: result.detectedLanguage,
        transcribedBody: result.transcript,
        translatedTranscript: result.translatedTranscript,
        transcribedAt: new Date(),
      },
    }),
  );
}

// Fire-and-forget from the post/message creation routes — see their call
// sites. A first attempt that fails in a retryable way is queued for later.

export async function translateAndStoreUpdatePost(postId: string, body: string): Promise<void> {
  if ((await attemptUpdatePostTranslation(postId, body)) === 'retry') await scheduleTranslationRetry('UPDATE_POST', postId);
}

export async function translateAndStoreTeaching(teachingId: string): Promise<void> {
  if ((await attemptTeachingTranslation(teachingId)) === 'retry') await scheduleTranslationRetry('TEACHING', teachingId);
}

export async function translateAndStoreMessage(messageId: string, body: string): Promise<void> {
  if ((await attemptMessageTranslation(messageId, body)) === 'retry') await scheduleTranslationRetry('MESSAGE_TEXT', messageId);
}

export async function transcribeAndStoreMessageAudio(messageId: string, storageKey: string, mimeType: string): Promise<void> {
  if ((await attemptMessageAudioTranscription(messageId, storageKey, mimeType)) === 'retry') {
    await scheduleTranslationRetry('MESSAGE_AUDIO', messageId);
  }
}
