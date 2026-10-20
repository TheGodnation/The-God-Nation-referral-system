import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../lib/storage', () => ({
  getObjectStream: vi.fn(async () => null),
}));

import { prisma } from '../lib/prisma';
import * as storage from '../lib/storage';

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

const geminiDown = () => Promise.reject(new Error('This operation was aborted'));

let phone = 0;
async function makeMessage(body: string | null) {
  phone += 1;
  const sender = await prisma.person.create({ data: { name: 'Retry Sender', whatsappNumber: `+23769940${String(phone).padStart(4, '0')}` } });
  const community = await prisma.community.create({ data: { name: `Retry Community ${phone}` } });
  const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
  return prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body } });
}

async function queueDue(kind: 'MESSAGE_TEXT' | 'MESSAGE_AUDIO' | 'UPDATE_POST', targetId: string, attempts = 0) {
  return prisma.translationRetry.create({ data: { kind, targetId, attempts, nextAttemptAt: new Date(Date.now() - 1000) } });
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Translation retries — a failed first attempt is tried again later, and translated once', () => {
  it('queues a message for a retry in 5 minutes when its first translation attempt fails', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(geminiDown));
    const message = await makeMessage('Bonjour à tous');

    const before = Date.now();
    await translation.translateAndStoreMessage(message.id, 'Bonjour à tous');

    const rows = await prisma.translationRetry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'MESSAGE_TEXT', targetId: message.id, attempts: 0 });
    const delay = rows[0].nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(delay).toBeLessThan(5 * 60 * 1000 + 10_000);
  });

  it('queues nothing when translation is not configured, or there is nothing to translate', async () => {
    const unconfigured = await freshModules({ GEMINI_API_KEY: '' });
    const message = await makeMessage('Bonjour');
    await unconfigured.translation.translateAndStoreMessage(message.id, 'Bonjour');

    const configured = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(geminiDown));
    await configured.translation.translateAndStoreMessage(message.id, '   ');

    expect(await prisma.translationRetry.count()).toBe(0);
  });

  it('queues a voice note whose transcription fails, but not one whose file is gone', async () => {
    const { translation } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(geminiDown));
    const failing = await makeMessage(null);
    const missing = await makeMessage(null);

    vi.mocked(storage.getObjectStream).mockResolvedValueOnce({ body: Readable.from([Buffer.from('audio')]), contentLength: 5 });
    await translation.transcribeAndStoreMessageAudio(failing.id, 'communities/x/attachments/a', 'audio/webm');
    vi.mocked(storage.getObjectStream).mockResolvedValueOnce(null);
    await translation.transcribeAndStoreMessageAudio(missing.id, 'communities/x/attachments/b', 'audio/webm');

    const rows = await prisma.translationRetry.findMany();
    expect(rows.map((r) => [r.kind, r.targetId])).toEqual([['MESSAGE_AUDIO', failing.id]]);
  });

  it('a due retry that succeeds stores the translation and removes the retry — one single Gemini request', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(async () => geminiOk({ detectedLanguage: 'fr', translated: 'Hello everyone' }));
    vi.stubGlobal('fetch', fetchSpy);
    const message = await makeMessage('Bonjour à tous');
    await queueDue('MESSAGE_TEXT', message.id);

    await retry.processDueTranslationRetries();

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored?.translatedBody).toBe('Hello everyone');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await prisma.translationRetry.count()).toBe(0);
  });

  it('a retry that fails again makes one request only, and is rescheduled 15 minutes later', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(geminiDown);
    vi.stubGlobal('fetch', fetchSpy);
    const message = await makeMessage('Bonjour');
    await queueDue('MESSAGE_TEXT', message.id);

    const before = Date.now();
    await retry.processDueTranslationRetries();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const row = await prisma.translationRetry.findFirstOrThrow();
    expect(row.attempts).toBe(1);
    expect(row.lockedUntil).toBeNull();
    const delay = row.nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
    expect(delay).toBeLessThan(15 * 60 * 1000 + 10_000);
  });

  it('gives up after the third retry fails', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(geminiDown));
    const message = await makeMessage('Bonjour');
    await queueDue('MESSAGE_TEXT', message.id, 2);

    await retry.processDueTranslationRetries();

    expect(await prisma.translationRetry.count()).toBe(0);
    expect((await prisma.message.findUnique({ where: { id: message.id } }))?.translatedBody).toBeNull();
  });

  it('never translates twice: an already-translated, deleted or missing item is dropped without calling Gemini', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(geminiDown);
    vi.stubGlobal('fetch', fetchSpy);
    const translated = await makeMessage('Bonjour');
    await prisma.message.update({ where: { id: translated.id }, data: { detectedLanguage: 'fr', translatedBody: 'Hello', translatedAt: new Date() } });
    const deleted = await makeMessage('Au revoir');
    await prisma.message.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await queueDue('MESSAGE_TEXT', translated.id);
    await queueDue('MESSAGE_TEXT', deleted.id);
    await queueDue('UPDATE_POST', '00000000-0000-0000-0000-000000000000');

    await retry.processDueTranslationRetries();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.translationRetry.count()).toBe(0);
  });

  it('leaves a retry that is not yet due alone', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(geminiDown);
    vi.stubGlobal('fetch', fetchSpy);
    const message = await makeMessage('Bonjour');
    await prisma.translationRetry.create({ data: { kind: 'MESSAGE_TEXT', targetId: message.id, nextAttemptAt: new Date(Date.now() + 60_000) } });

    await retry.processDueTranslationRetries();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await prisma.translationRetry.findFirstOrThrow()).attempts).toBe(0);
  });

  it('two servers checking at the same moment make only one request for the same item', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return geminiOk({ detectedLanguage: 'fr', translated: 'Hello' });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const message = await makeMessage('Bonjour');
    await queueDue('MESSAGE_TEXT', message.id);

    await Promise.all([retry.processDueTranslationRetries(), retry.processDueTranslationRetries()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await prisma.message.findUnique({ where: { id: message.id } }))?.translatedBody).toBe('Hello');
  });

  it('retries an Updates post and a voice note too', async () => {
    const { retry } = await freshModules({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(geminiOk({ detectedLanguage: 'fr', translated: 'Praise God' }))
        .mockResolvedValueOnce(geminiOk({ detectedLanguage: 'fr', transcript: 'Merci', translated: 'Thank you' })),
    );
    const author = await prisma.person.create({ data: { name: 'Retry Author', whatsappNumber: '+237699499999' } });
    const post = await prisma.updatePost.create({ data: { authorPersonId: author.id, body: 'Louons Dieu' } });
    const voice = await makeMessage(null);
    await prisma.messageAttachment.create({
      data: { messageId: voice.id, storageKey: 'communities/x/attachments/v', originalFilename: 'voice.webm', mimeType: 'audio/webm', byteSize: 5, uploadedByPersonId: voice.senderPersonId },
    });
    vi.mocked(storage.getObjectStream).mockResolvedValueOnce({ body: Readable.from([Buffer.from('audio')]), contentLength: 5 });
    await prisma.translationRetry.create({ data: { kind: 'UPDATE_POST', targetId: post.id, nextAttemptAt: new Date(Date.now() - 2000) } });
    await queueDue('MESSAGE_AUDIO', voice.id);

    await retry.processDueTranslationRetries();

    expect((await prisma.updatePost.findUnique({ where: { id: post.id } }))?.translatedBody).toBe('Praise God');
    expect((await prisma.message.findUnique({ where: { id: voice.id } }))?.translatedTranscript).toBe('Thank you');
    expect(await prisma.translationRetry.count()).toBe(0);
  });
});
