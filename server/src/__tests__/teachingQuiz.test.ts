import { describe, it, expect, vi } from 'vitest';

const callGemini = vi.fn();
vi.mock('../lib/translation', () => ({ callGemini: (...a: unknown[]) => callGemini(...a), isTranslationConfigured: () => true }));

import { cleanDraft, draftQuizQuestions } from '../lib/teachingQuiz';

const GOOD = {
  textEn: ' Who is the teaching about? ',
  textFr: 'De qui parle l’enseignement ?',
  options: [
    { textEn: 'Moses', textFr: 'Moïse' },
    { textEn: 'Jesus', textFr: 'Jésus' },
    { textEn: 'Paul', textFr: 'Paul' },
  ],
  correctIndex: 1,
};

describe('Drafting teaching questions with AI', () => {
  it('keeps only well-formed questions', () => {
    const out = cleanDraft(
      {
        questions: [
          GOOD,
          { ...GOOD, correctIndex: 7 },
          { ...GOOD, textEn: '' },
          { ...GOOD, options: [{ textEn: 'only one', textFr: '' }] },
          { textEn: 'No French', options: [{ textEn: 'a' }, { textEn: 'b' }], correctIndex: 0 },
        ],
      },
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ textEn: 'Who is the teaching about?', correctIndex: 1 });
    // A missing French text falls back to the English one.
    expect(out[1].textFr).toBe('No French');
    expect(out[1].options[0].textFr).toBe('a');
  });

  it('respects the requested count and rubbish input', () => {
    expect(cleanDraft({ questions: [GOOD, GOOD, GOOD] }, 2)).toHaveLength(2);
    expect(cleanDraft(null, 5)).toEqual([]);
    expect(cleanDraft({ questions: 'x' }, 5)).toEqual([]);
  });

  it('sends the text (and audio) to Gemini and returns the cleaned draft, or null when nothing usable comes back', async () => {
    callGemini.mockResolvedValueOnce({ questions: [GOOD] });
    const out = await draftQuizQuestions({ text: 'Love one another.', audio: { base64: 'AAA', mimeType: 'audio/webm' }, count: 5 });
    expect(out).toHaveLength(1);
    const sent = callGemini.mock.calls[0][0][0].parts;
    expect(sent[0].text).toContain('Love one another.');
    expect(sent[1].inlineData).toEqual({ mimeType: 'audio/webm', data: 'AAA' });

    callGemini.mockResolvedValueOnce({ questions: [{ textEn: '' }] });
    expect(await draftQuizQuestions({ text: 'x', count: 3 })).toBeNull();
    callGemini.mockResolvedValueOnce(null);
    expect(await draftQuizQuestions({ text: 'x', count: 3 })).toBeNull();
    expect(await draftQuizQuestions({ text: '  ', count: 3 })).toBeNull();
  });
});
