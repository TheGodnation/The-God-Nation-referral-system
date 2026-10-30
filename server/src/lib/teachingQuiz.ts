import { callGemini, isTranslationConfigured } from './translation';

// "Draft the questions with AI" for a teaching: Gemini reads the written
// text (or listens to the audio) and proposes multiple-choice questions in
// English and French. They are only a draft — the central admin reads,
// edits and confirms them before the teaching is posted.

export interface DraftQuestion {
  textEn: string;
  textFr: string;
  options: { textEn: string; textFr: string }[];
  correctIndex: number;
}

const schema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          textEn: { type: 'string' },
          textFr: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { textEn: { type: 'string' }, textFr: { type: 'string' } },
              required: ['textEn', 'textFr'],
            },
          },
          correctIndex: { type: 'integer' },
        },
        required: ['textEn', 'textFr', 'options', 'correctIndex'],
      },
    },
  },
  required: ['questions'],
};

const MAX_TEXT_CHARS = 60000;

export function isQuizDraftingAvailable(): boolean {
  return isTranslationConfigured();
}

/** Keeps only well-formed questions (2–6 options, a valid correct answer, no blanks). */
export function cleanDraft(raw: unknown, count: number): DraftQuestion[] {
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];
  const out: DraftQuestion[] = [];
  for (const q of list) {
    const textEn = String(q?.textEn ?? '').trim();
    const textFr = String(q?.textFr ?? '').trim();
    const options = (Array.isArray(q?.options) ? q.options : [])
      .map((o: any) => ({ textEn: String(o?.textEn ?? '').trim(), textFr: String(o?.textFr ?? '').trim() }))
      .filter((o: { textEn: string }) => o.textEn);
    const correctIndex = Number(q?.correctIndex);
    if (!textEn || options.length < 2 || options.length > 6 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) continue;
    out.push({
      textEn: textEn.slice(0, 500),
      textFr: (textFr || textEn).slice(0, 500),
      options: options.map((o: { textEn: string; textFr: string }) => ({ textEn: o.textEn.slice(0, 300), textFr: (o.textFr || o.textEn).slice(0, 300) })),
      correctIndex,
    });
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Drafts `count` questions from the teaching's text and/or its audio.
 * Returns null when drafting isn't possible right now (not configured, or
 * Gemini failed) — the admin can always write the questions by hand.
 */
export async function draftQuizQuestions(input: {
  text?: string | null;
  audio?: { base64: string; mimeType: string } | null;
  count: number;
  /** Questions already asked: the new ones must be about other points and worded differently. */
  avoid?: string[];
}): Promise<DraftQuestion[] | null> {
  if (!isQuizDraftingAvailable()) return null;
  const text = (input.text ?? '').trim().slice(0, MAX_TEXT_CHARS);
  if (!text && !input.audio) return null;

  const prompt =
    `You help a church teacher check that people understood a teaching. Write exactly ${input.count} multiple-choice questions ` +
    'about the teaching below. Rules: each question has 4 short answer options and exactly one correct option; ' +
    'questions must be answerable from the teaching itself (not outside knowledge), in simple clear language, ' +
    'covering different parts of the teaching; wrong options must be believable but clearly wrong according to the teaching; ' +
    'put the correct option at a random position and give its position as correctIndex (starting at 0). ' +
    'Write every question and option in both English (textEn) and French (textFr).' +
    (input.avoid?.length
      ? '\n\nThese questions were already asked. Write completely different questions about other points of the teaching, ' +
        'and do not repeat or rephrase any of them:\n' +
        input.avoid.map((q) => `- ${q}`).join('\n')
      : '') +
    (text ? `\n\nTeaching text:\n"""${text}"""` : '') +
    (input.audio ? '\n\nThe teaching is also in the attached audio.' : '');

  const parts: unknown[] = [{ text: prompt }];
  if (input.audio) parts.push({ inlineData: { mimeType: input.audio.mimeType, data: input.audio.base64 } });
  const result = await callGemini([{ role: 'user', parts }], schema, { timeoutMs: 120000, attempts: 1 });
  if (!result) return null;
  const cleaned = cleanDraft(result, input.count);
  return cleaned.length ? cleaned : null;
}
