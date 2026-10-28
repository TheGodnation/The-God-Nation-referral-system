import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/storage', () => ({
  getObjectStream: vi.fn(async () => null),
}));

import { prisma } from '../lib/prisma';

const ORIGINAL_ENV = { ...process.env };

async function freshModules(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  const translation = await import('../lib/translation');
  const retry = await import('../lib/translationRetry');
  return { translation, retry };
}

function geminiOk(payload: unknown) {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
}

let n = 0;
/** A teaching with a two-question quiz; `fr` marks the quiz as written in French (stored in textEn, like the app does). */
async function makeTeaching(opts: { fr?: boolean; text?: string | null; withFrenchQuiz?: boolean } = {}) {
  n += 1;
  const author = await prisma.person.create({ data: { name: 'Teacher', whatsappNumber: `+23769950${String(n).padStart(4, '0')}` } });
  const community = await prisma.community.create({ data: { name: `Teaching Translation ${n}` } });
  const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
  const title = opts.fr ? 'Marcher dans l’amour' : 'Walking in love';
  const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: author.id, body: title } });
  const assessment = await prisma.assessment.create({
    data: {
      titleEn: 'Teaching quiz',
      passMark: 50,
      status: 'PUBLISHED',
      questions: {
        create: [
          {
            textEn: opts.fr ? 'Qui est le sujet ?' : 'Who is it about?',
            textFr: opts.withFrenchQuiz ? 'Déjà écrit' : null,
            order: 0,
            options: {
              create: [
                { textEn: opts.fr ? 'Moïse' : 'Moses', order: 0 },
                { textEn: opts.fr ? 'Jésus' : 'Jesus', isCorrect: true, order: 1 },
              ],
            },
          },
          { textEn: opts.fr ? 'Où ?' : 'Where?', order: 1, options: { create: [{ textEn: opts.fr ? 'Galilée' : 'Galilee', isCorrect: true, order: 0 }, { textEn: opts.fr ? 'Rome' : 'Rome', order: 1 }] } },
        ],
      },
    },
  });
  const text = opts.text === undefined ? (opts.fr ? 'Aimez-vous les uns les autres.' : 'Love one another.') : opts.text;
  return prisma.teaching.create({
    data: { communityId: community.id, messageId: message.id, assessmentId: assessment.id, authorPersonId: author.id, title, text, closesAt: new Date(Date.now() + 86_400_000) },
  });
}

const load = (id: string) =>
  prisma.teaching.findUniqueOrThrow({
    where: { id },
    include: { message: true, assessment: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } } },
  });

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Teaching auto-translation — title, text and quiz in the other language', () => {
  it('translates an English teaching into French: title, text, chat card and quiz (textFr)', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    const fetchMock = vi.fn(async () =>
      geminiOk({
        detectedLanguage: 'en',
        title: 'Marcher dans l’amour',
        text: 'Aimez-vous les uns les autres.',
        questions: [
          { text: 'De qui s’agit-il ?', options: ['Moïse', 'Jésus'] },
          { text: 'Où ?', options: ['Galilée', 'Rome'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const t = await makeTeaching();

    expect(await translation.attemptTeachingTranslation(t.id)).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const after = await load(t.id);
    expect(after).toMatchObject({ detectedLanguage: 'en', titleTranslated: 'Marcher dans l’amour', textTranslated: 'Aimez-vous les uns les autres.' });
    expect(after.translatedAt).not.toBeNull();
    expect(after.message).toMatchObject({ detectedLanguage: 'en', translatedBody: 'Marcher dans l’amour' });
    const [q1, q2] = after.assessment.questions;
    expect(q1).toMatchObject({ textEn: 'Who is it about?', textFr: 'De qui s’agit-il ?' });
    expect(q1.options.map((o) => [o.textEn, o.textFr, o.isCorrect])).toEqual([
      ['Moses', 'Moïse', false],
      ['Jesus', 'Jésus', true],
    ]);
    expect(q2.options.map((o) => o.textFr)).toEqual(['Galilée', 'Rome']);
  });

  it('translates a French teaching into English: the quiz the author typed moves to textFr, the English goes in textEn', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiOk({
          detectedLanguage: 'fr',
          title: 'Walking in love',
          text: 'Love one another.',
          questions: [
            { text: 'Who is it about?', options: ['Moses', 'Jesus'] },
            { text: 'Where?', options: ['Galilee', 'Rome'] },
          ],
        }),
      ),
    );
    const t = await makeTeaching({ fr: true });

    expect(await translation.attemptTeachingTranslation(t.id)).toBe('done');
    const after = await load(t.id);
    expect(after).toMatchObject({ detectedLanguage: 'fr', titleTranslated: 'Walking in love', textTranslated: 'Love one another.' });
    const [q1] = after.assessment.questions;
    expect(q1).toMatchObject({ textEn: 'Who is it about?', textFr: 'Qui est le sujet ?' });
    expect(q1.options.map((o) => [o.textEn, o.textFr])).toEqual([
      ['Moses', 'Moïse'],
      ['Jesus', 'Jésus'],
    ]);
  });

  it('leaves a question the author already wrote in both languages exactly as written', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiOk({
          detectedLanguage: 'en',
          title: 'Marcher dans l’amour',
          text: 'x',
          questions: [
            { text: 'Autre', options: ['A', 'B'] },
            { text: 'Où ?', options: ['Galilée', 'Rome'] },
          ],
        }),
      ),
    );
    const t = await makeTeaching({ withFrenchQuiz: true });
    await translation.attemptTeachingTranslation(t.id);
    const [q1, q2] = (await load(t.id)).assessment.questions;
    expect(q1.textFr).toBe('Déjà écrit');
    expect(q1.options.map((o) => o.textFr)).toEqual(['A', 'B']);
    expect(q2.textFr).toBe('Où ?');
  });

  it('a teaching with only a title (audio, no written text) has no translated text', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiOk({
          detectedLanguage: 'en',
          title: 'Marcher dans l’amour',
          text: '',
          questions: [
            { text: 'a', options: ['b', 'c'] },
            { text: 'd', options: ['e', 'f'] },
          ],
        }),
      ),
    );
    const t = await makeTeaching({ text: null });
    expect(await translation.attemptTeachingTranslation(t.id)).toBe('done');
    expect(await load(t.id)).toMatchObject({ titleTranslated: 'Marcher dans l’amour', textTranslated: null });
  });

  it('refuses an answer whose question or answer counts do not match (never puts words on the wrong answer)', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => geminiOk({ detectedLanguage: 'en', title: 'T', text: 'x', questions: [{ text: 'a', options: ['b', 'c'] }] })),
    );
    const t = await makeTeaching();
    expect(await translation.attemptTeachingTranslation(t.id)).toBe('retry');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiOk({ detectedLanguage: 'en', title: 'T', text: 'x', questions: [{ text: 'a', options: ['b'] }, { text: 'd', options: ['e', 'f'] }] }),
      ),
    );
    expect(await translation.attemptTeachingTranslation(t.id)).toBe('retry');
    const after = await load(t.id);
    expect(after.translatedAt).toBeNull();
    expect(after.assessment.questions[0].textFr).toBeNull();
  });

  it('does nothing without a Gemini key, and never translates twice', async () => {
    const off = await freshModules({ GEMINI_API_KEY: '' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const t = await makeTeaching();
    expect(await off.translation.attemptTeachingTranslation(t.id)).toBe('skip');
    expect(fetchSpy).not.toHaveBeenCalled();

    const on = await freshModules({ GEMINI_API_KEY: 'test-key' });
    await prisma.teaching.update({ where: { id: t.id }, data: { translatedAt: new Date() } });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await on.translation.attemptTeachingTranslation(t.id)).toBe('skip');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queues a retry when the first attempt fails, and the retry loop translates it later', async () => {
    const { translation, retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('aborted'))));
    const t = await makeTeaching();
    await translation.translateAndStoreTeaching(t.id);

    const rows = await prisma.translationRetry.findMany({ where: { targetId: t.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'TEACHING', attempts: 0 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiOk({
          detectedLanguage: 'en',
          title: 'Marcher dans l’amour',
          text: 'Aimez-vous.',
          questions: [
            { text: 'a', options: ['b', 'c'] },
            { text: 'd', options: ['e', 'f'] },
          ],
        }),
      ),
    );
    await prisma.translationRetry.update({ where: { id: rows[0].id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await retry.processDueTranslationRetries();

    expect((await load(t.id)).titleTranslated).toBe('Marcher dans l’amour');
    expect(await prisma.translationRetry.findMany({ where: { targetId: t.id } })).toHaveLength(0);
  });
});
