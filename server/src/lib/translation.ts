import type { Language } from '@prisma/client';
import { prisma } from './prisma';
import { getObjectStream } from './storage';

// Auto-translation (Gemini) — text translation on Updates posts and
// Community group-chat messages, and voice-note transcription+translation in
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
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 20000;

export function isTranslationConfigured(): boolean {
  return Boolean(GEMINI_API_KEY);
}

// A conservative cutoff for inline audio (base64 adds ~33% to the raw
// byte size) — comfortably under Gemini's inline-request size limit. A
// voice note larger than this (attachmentPolicy.ts already caps audio at
// 20MB) simply never gets transcribed — a safe, silent degrade, same as
// any other failure here.
const MAX_INLINE_AUDIO_BYTES = 15 * 1024 * 1024;

async function callGemini(contents: unknown[], schema: unknown): Promise<any | null> {
  if (!GEMINI_API_KEY) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
export async function translateText(text: string): Promise<TextTranslationResult | null> {
  if (!GEMINI_API_KEY || !text.trim()) return null;
  const prompt =
    'Detect whether the following message is written in English or French, then translate it into ' +
    'the other of those two languages. Keep the tone, emoji and meaning natural; reply with the ' +
    'translation only, no commentary.\n\nMessage:\n"""' +
    text +
    '"""';
  const result = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], textSchema);
  if (!result || !isLanguage(result.detectedLanguage) || typeof result.translated !== 'string') return null;
  return { detectedLanguage: result.detectedLanguage, translatedBody: result.translated };
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
export async function transcribeAndTranslateAudio(audioBase64: string, mimeType: string): Promise<AudioTranslationResult | null> {
  if (!GEMINI_API_KEY) return null;
  // Rough check: base64 is ~4/3 the raw size.
  if (audioBase64.length * 0.75 > MAX_INLINE_AUDIO_BYTES) return null;
  const prompt =
    'Transcribe this voice message exactly as spoken. Detect whether it is English or French, and also ' +
    'translate the transcript into the other of those two languages.';
  const result = await callGemini(
    [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }] }],
    audioSchema,
  );
  if (!result || !isLanguage(result.detectedLanguage) || typeof result.transcript !== 'string' || typeof result.translated !== 'string') {
    return null;
  }
  return { detectedLanguage: result.detectedLanguage, transcript: result.transcript, translatedTranscript: result.translated };
}

/** Fire-and-forget from the Updates post-creation route — see its own call site. */
export async function translateAndStoreUpdatePost(postId: string, body: string): Promise<void> {
  const result = await translateText(body);
  if (!result) return;
  await prisma.updatePost
    .update({
      where: { id: postId },
      data: { detectedLanguage: result.detectedLanguage, translatedBody: result.translatedBody, translatedAt: new Date() },
    })
    .catch(() => {});
}

/** Fire-and-forget from the group-chat message-creation route — see its own call site. */
export async function translateAndStoreMessage(messageId: string, body: string): Promise<void> {
  const result = await translateText(body);
  if (!result) return;
  await prisma.message
    .update({
      where: { id: messageId },
      data: { detectedLanguage: result.detectedLanguage, translatedBody: result.translatedBody, translatedAt: new Date() },
    })
    .catch(() => {});
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Fire-and-forget from the group-chat message-creation route, for a voice
 * note's own attachment. Downloads the object from storage server-side
 * (never exposed to the client), then transcribes+translates and stores
 * the result. A storage read failure degrades the same as a Gemini
 * failure — no transcript, nothing thrown.
 */
export async function transcribeAndStoreMessageAudio(messageId: string, storageKey: string, mimeType: string): Promise<void> {
  if (!GEMINI_API_KEY) return;
  const object = await getObjectStream({ storageKey }).catch(() => null);
  if (!object) return;
  if (object.contentLength && object.contentLength > MAX_INLINE_AUDIO_BYTES) return;
  const buffer = await streamToBuffer(object.body).catch(() => null);
  if (!buffer) return;
  const result = await transcribeAndTranslateAudio(buffer.toString('base64'), mimeType);
  if (!result) return;
  await prisma.message
    .update({
      where: { id: messageId },
      data: {
        transcribedLanguage: result.detectedLanguage,
        transcribedBody: result.transcript,
        translatedTranscript: result.translatedTranscript,
        transcribedAt: new Date(),
      },
    })
    .catch(() => {});
}
