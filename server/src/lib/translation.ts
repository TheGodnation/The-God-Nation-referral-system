import type { Language } from '@prisma/client';
import { prisma } from './prisma';
import { getObjectStream, putObject } from './storage';
import { generateStorageKey } from './attachmentPolicy';

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
// gemini-2.0-flash was retired by Google; gemini-3.8-flash is its
// replacement per Gemini's own 404 response naming it directly.
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 20000;
// Gemini occasionally answers 503 "This model is currently experiencing
// high demand" — a transient capacity issue on Google's side, not a bug
// here. One short-delay retry absorbs that without ever doubling the
// user-visible latency on an outright failure.
const RETRY_DELAY_MS = 1500;
const MAX_ATTEMPTS = 2;

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
async function postGeminiJson(url: string, body: unknown): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 503 && attempt < MAX_ATTEMPTS) {
        console.warn('[translation] Gemini reported high demand (503) — retrying once', { attempt });
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
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

async function callGemini(contents: unknown[], schema: unknown): Promise<any | null> {
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
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error('[translation] Gemini responded with a non-OK status', { status: res.status, body: bodyText.slice(0, 500) });
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
export async function translateText(text: string): Promise<TextTranslationResult | null> {
  if (!text.trim()) return null;
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

// Voice-to-voice — speaking the translated transcript back as audio.
// gemini-3.8-flash-preview-tts (a guess by analogy to the confirmed chat
// model name above) 404ed; Gemini's own ListModels endpoint (queried via
// logAvailableTtsModels below) confirmed the real name.
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_VOICE_NAME = 'Kore';

let loggedAvailableTtsModels = false;

/**
 * Calls Gemini's ListModels endpoint and logs every model whose
 * supportedGenerationMethods includes generateContent, so the real TTS
 * model name can be read directly from production logs instead of guessed
 * again. Best-effort and silent on its own failure — this is a diagnostic
 * aid, not something callers depend on.
 */
async function logAvailableTtsModels(): Promise<void> {
  if (loggedAvailableTtsModels) return;
  loggedAvailableTtsModels = true;
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
    console.error('[translation] Gemini models supporting generateContent (looking for the real TTS model name)', { generateContentModels });
  } catch (err) {
    console.error('[translation] ListModels call threw', { error: err instanceof Error ? err.message : String(err) });
  }
}

function wavHeader(pcmLength: number, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

export interface SynthesizedSpeech {
  audio: Buffer;
  mimeType: string;
}

/**
 * Synthesizes `text` as spoken audio via Gemini's native TTS. Gemini
 * returns raw PCM with no container (mimeType like "audio/L16;rate=24000"),
 * which a plain <audio>/voice-note player can't play — this wraps it in a
 * minimal WAV header so it's directly playable. Returns null on any
 * failure, same degrade rule as everything else here.
 */
export async function synthesizeSpeech(text: string): Promise<SynthesizedSpeech | null> {
  if (!text.trim()) return null;
  if (!GEMINI_API_KEY) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[translation] GEMINI_API_KEY not configured — translation/transcription disabled');
    }
    return null;
  }
  try {
    const res = await postGeminiJson(`${GEMINI_BASE_URL}/${GEMINI_TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE_NAME } } },
      },
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error('[translation] Gemini TTS responded with a non-OK status', { status: res.status, body: bodyText.slice(0, 500) });
      if (res.status === 404) {
        void logAvailableTtsModels();
      }
      return null;
    }
    const data: any = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.[0];
    const base64 = part?.inlineData?.data;
    const mimeType: string | undefined = part?.inlineData?.mimeType;
    if (typeof base64 !== 'string') {
      console.error('[translation] Gemini TTS response had no audio data', { data: JSON.stringify(data).slice(0, 500) });
      return null;
    }
    const pcm = Buffer.from(base64, 'base64');
    if (mimeType && !mimeType.startsWith('audio/L16') && !mimeType.startsWith('audio/pcm')) {
      // Already containerized (wav/mp3/etc) — pass through untouched.
      return { audio: pcm, mimeType };
    }
    const rateMatch = mimeType?.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    return { audio: Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]), mimeType: 'audio/wav' };
  } catch (err) {
    console.error('[translation] Gemini TTS call threw', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
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
export async function transcribeAndStoreMessageAudio(messageId: string, communityId: string, storageKey: string, mimeType: string): Promise<void> {
  // Skip the storage download entirely when unconfigured — no point
  // fetching audio we can't transcribe. callGemini's own warning covers the
  // text-translation path; this one is separate since a pure voice note has
  // no body for that path to ever run.
  if (!GEMINI_API_KEY) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[translation] GEMINI_API_KEY not configured — translation/transcription disabled');
    }
    return;
  }
  const object = await getObjectStream({ storageKey }).catch((err) => {
    console.error('[translation] failed to read voice note from storage', { storageKey, error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (!object) return;
  if (object.contentLength && object.contentLength > MAX_INLINE_AUDIO_BYTES) {
    console.warn('[translation] voice note too large to transcribe inline', { storageKey, contentLength: object.contentLength });
    return;
  }
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

  // Voice-to-voice: speak the translated transcript back as audio and
  // store it alongside. A failure here never touches the transcript/
  // translation already saved above — those remain visible as text either
  // way.
  const speech = await synthesizeSpeech(result.translatedTranscript);
  if (!speech) return;
  const audioStorageKey = generateStorageKey(communityId);
  const stored = await putObject({ storageKey: audioStorageKey, body: speech.audio, contentType: speech.mimeType })
    .then(() => true)
    .catch((err) => {
      console.error('[translation] failed to store synthesized voice audio', { error: err instanceof Error ? err.message : String(err) });
      return false;
    });
  if (!stored) return;
  await prisma.message
    .update({
      where: { id: messageId },
      data: {
        translatedAudioStorageKey: audioStorageKey,
        translatedAudioMimeType: speech.mimeType,
        // The synthesized audio is always in the language the translated
        // transcript is written in — the "other" one from what was spoken.
        translatedAudioLanguage: result.detectedLanguage === 'en' ? 'fr' : 'en',
        translatedAudioAt: new Date(),
      },
    })
    .catch(() => {});
}
