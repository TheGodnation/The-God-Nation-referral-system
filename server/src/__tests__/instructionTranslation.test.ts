import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '../lib/prisma';
import { titleIn, instructionNotice } from '../lib/leaderInstructions';

// Leader instructions are translated EN<->FR: saved first, translated right away when possible, retried when not,
// and re-queued at start-up when a translation never arrived.
const ORIGINAL_ENV = { ...process.env };

async function fresh(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  const translation = await import('../lib/translation');
  const retry = await import('../lib/translationRetry');
  return { translation, retry };
}
const ok = (payload: unknown) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) });
const down = () => Promise.reject(new Error('This operation was aborted'));

// Answers by what is being translated: the body contains "BODY", the title does not.
function gemini(failTitle = false) {
  return vi.fn(async (_url: unknown, init: any) => {
    const sent = String(init?.body ?? '');
    if (sent.includes('Message:\\n\\"\\"\\"Hello leaders BODY')) return ok({ detectedLanguage: 'en', translated: 'Bonjour aux responsables CORPS' });
    if (sent.includes('Message:\\n\\"\\"\\"Weekly call')) return failTitle ? down() : ok({ detectedLanguage: 'en', translated: 'Appel hebdomadaire' });
    return down();
  });
}

let n = 0;
const makeInstruction = () => {
  n += 1;
  return prisma.leaderInstruction.create({ data: { title: `Weekly call`, body: 'Hello leaders BODY', audience: 'ALL_LEADERS' } });
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Instruction translation', () => {
  it('translates title and text separately and stores both with the detected language', async () => {
    const { translation } = await fresh({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', gemini());
    const i = await makeInstruction();
    expect(await translation.attemptInstructionTranslation(i.id)).toBe('done');
    const s = await prisma.leaderInstruction.findUniqueOrThrow({ where: { id: i.id } });
    expect(s).toMatchObject({ language: 'en', titleTr: 'Appel hebdomadaire', bodyTr: 'Bonjour aux responsables CORPS' });
  });

  it('keeps what worked when one part fails, asks for a retry, and the retry only does the missing part', async () => {
    const { translation } = await fresh({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', gemini(true));
    const i = await makeInstruction();
    expect(await translation.attemptInstructionTranslation(i.id)).toBe('retry');
    let s = await prisma.leaderInstruction.findUniqueOrThrow({ where: { id: i.id } });
    expect(s.bodyTr).toBe('Bonjour aux responsables CORPS');
    expect(s.titleTr).toBeNull();
    const spy = gemini();
    vi.stubGlobal('fetch', spy);
    expect(await translation.attemptInstructionTranslation(i.id)).toBe('done');
    expect(spy).toHaveBeenCalledTimes(1);
    s = await prisma.leaderInstruction.findUniqueOrThrow({ where: { id: i.id } });
    expect(s.titleTr).toBe('Appel hebdomadaire');
  });

  it('never overwrites a translation that is already there, and skips when translation is off', async () => {
    const off = await fresh({ GEMINI_API_KEY: '' });
    const i = await makeInstruction();
    expect(await off.translation.attemptInstructionTranslation(i.id)).toBe('skip');
    const { translation } = await fresh({ GEMINI_API_KEY: 'test-key' });
    const spy = vi.fn(down);
    vi.stubGlobal('fetch', spy);
    await prisma.leaderInstruction.update({ where: { id: i.id }, data: { language: 'en', titleTr: 'Mon titre', bodyTr: 'Mon texte' } });
    expect(await translation.attemptInstructionTranslation(i.id)).toBe('skip');
    expect(spy).not.toHaveBeenCalled();
  });

  it('when the translator is down the instruction is queued for a retry in 5 minutes, and nothing is lost', async () => {
    const { translation } = await fresh({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(down));
    const i = await makeInstruction();
    const before = Date.now();
    await translation.translateInstructionBeforeSending(i.id);
    const row = await prisma.translationRetry.findFirstOrThrow({ where: { kind: 'INSTRUCTION', targetId: i.id } });
    expect(row.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(await prisma.leaderInstruction.count({ where: { id: i.id } })).toBe(1);
  });

  it('a due retry translates the instruction and clears itself', async () => {
    const { retry } = await fresh({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', gemini());
    const i = await makeInstruction();
    await prisma.translationRetry.create({ data: { kind: 'INSTRUCTION', targetId: i.id, nextAttemptAt: new Date(Date.now() - 1000) } });
    await retry.processDueTranslationRetries();
    const s = await prisma.leaderInstruction.findUniqueOrThrow({ where: { id: i.id } });
    expect(s.bodyTr).toBe('Bonjour aux responsables CORPS');
    expect(await prisma.translationRetry.count({ where: { kind: 'INSTRUCTION', targetId: i.id } })).toBe(0);
  });

  it('start-up queues recent instructions that still have no translation, and no others', async () => {
    const { translation } = await fresh({ GEMINI_API_KEY: 'test-key' });
    const missing = await makeInstruction();
    const done = await prisma.leaderInstruction.create({ data: { title: 'A', body: 'B', titleTr: 'a', bodyTr: 'b', language: 'en', audience: 'ALL_LEADERS' } });
    const old = await prisma.leaderInstruction.create({ data: { title: 'Old', body: 'Old', audience: 'ALL_LEADERS', createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000) } });
    await translation.queueUntranslatedInstructions();
    const queued = (await prisma.translationRetry.findMany({ where: { kind: 'INSTRUCTION' } })).map((r) => r.targetId);
    expect(queued).toContain(missing.id);
    expect(queued).not.toContain(done.id);
    expect(queued).not.toContain(old.id);
  });

  it('each leader gets the title in their own language, and the original when no translation is ready', () => {
    const en = { title: 'Weekly call', titleTr: 'Appel hebdomadaire', language: 'en' as const };
    expect(titleIn(en, true)).toBe('Appel hebdomadaire');
    expect(titleIn(en, false)).toBe('Weekly call');
    const fr = { title: 'Appel hebdomadaire', titleTr: 'Weekly call', language: 'fr' as const };
    expect(titleIn(fr, false)).toBe('Weekly call');
    expect(titleIn(fr, true)).toBe('Appel hebdomadaire');
    expect(titleIn({ title: 'Weekly call', titleTr: null, language: null }, true)).toBe('Weekly call');
    expect(instructionNotice('new', titleIn(en, true), null, 'x', true)).toContain('Nouvelle instruction : Appel hebdomadaire');
  });
});
