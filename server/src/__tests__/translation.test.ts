import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../lib/storage', () => ({
  getObjectStream: vi.fn(async () => null),
}));

import { prisma } from '../lib/prisma';
import * as storage from '../lib/storage';

const ORIGINAL_ENV = { ...process.env };

async function freshTranslationModule(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../lib/translation');
}

function mockGeminiResponse(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
    })),
  );
}

// Voice notes take two calls: one listens (the request carries the audio), one cleans and translates the text.
function mockAudioGemini(listen: unknown, write: unknown, seen: { prompt: string }[] = []) {
  const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
    const parts = JSON.parse(init.body as string).contents[0].parts;
    seen.push({ prompt: parts[0].text });
    const payload = parts[1]?.inlineData ? listen : write;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lib/translation — Gemini-backed text translation and voice-note transcription', () => {
  it('gives long texts more time to translate (a long French post was cut off at 20s)', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'k' });
    expect(translation.textTimeoutMs('Bonjour')).toBe(31000);
    expect(translation.textTimeoutMs('x'.repeat(6000))).toBe(90000);
    expect(translation.textTimeoutMs('x'.repeat(65536))).toBe(180000);
  });

  it('is unconfigured, and every function silently no-ops, with no GEMINI_API_KEY set', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: '' });
    expect(translation.isTranslationConfigured()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await translation.translateText('Bonjour')).toBeNull();
    expect(await translation.transcribeAndTranslateAudio('abc', 'audio/webm')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is configured once GEMINI_API_KEY is set', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    expect(translation.isTranslationConfigured()).toBe(true);
  });

  it('translateText detects the language and returns the translation into the other one', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    mockGeminiResponse({ detectedLanguage: 'fr', translated: 'Good morning' });

    const result = await translation.translateText('Bonjour');
    expect(result).toEqual({ detectedLanguage: 'fr', translatedBody: 'Good morning' });
  });

  it('translateText asks Gemini to keep the formatting symbols and web addresses', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'fr', translated: '*Good* morning' }) }] } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await translation.translateText('*Bon* matin');
    const sent = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body).contents[0].parts[0].text as string;
    expect(sent).toMatch(/\*bold\*, _italic_, ~strikethrough~/);
    expect(sent).toMatch(/never translate or change web addresses/);
    expect(sent).toContain('*Bon* matin');
  });

  it('translateText returns null for empty or whitespace-only text, without calling Gemini', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await translation.translateText('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('translateText returns null if the Gemini call fails (network error)', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network blip'); }));
    expect(await translation.translateText('Bonjour')).toBeNull();
  });

  it('translateText returns null if Gemini responds with a non-OK status', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'API key not valid' })));
    expect(await translation.translateText('Bonjour')).toBeNull();
  });

  it('translateText retries once on a 503 "high demand" response, and succeeds if the retry does', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'high demand' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'fr', translated: 'Good morning' }) }] } }] }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await translation.translateText('Bonjour');
    expect(result).toEqual({ detectedLanguage: 'fr', translatedBody: 'Good morning' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('translateText gives up (returns null) after a second 503 in a row', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'high demand' }));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await translation.translateText('Bonjour')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('translateText asks Gemini\'s ListModels endpoint for a real model name when the model itself 404s', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'model not found' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await translation.translateText('Bonjour')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, [listModelsUrl]] = fetchSpy.mock.calls;
    expect(listModelsUrl).toContain('/v1beta/models?pageSize=200&key=test-key');
  });

  it('translateText returns null if the response is malformed (bad language, missing field)', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    mockGeminiResponse({ detectedLanguage: 'es', translated: 'Buenos días' });
    expect(await translation.translateText('Bonjour')).toBeNull();
  });

  it('transcribeAndTranslateAudio listens first, then corrects and translates the writing with the ministry context', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const seen: { prompt: string }[] = [];
    const fetchSpy = mockAudioGemini(
      { detectedLanguage: 'fr', transcript: 'priez pour moi' },
      { transcript: 'Priez pour moi.', translated: 'Pray for me.' },
      seen,
    );

    const result = await translation.transcribeAndTranslateAudio('ZmFrZS1hdWRpbw==', 'audio/webm');
    expect(result).toEqual({ detectedLanguage: 'fr', transcript: 'Priez pour moi.', translatedTranscript: 'Pray for me.' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The audio goes only to the listening step; the writing step gets the transcript and the context.
    const [listen, write] = seen;
    expect(listen.prompt).toContain('Cameroon');
    expect(write.prompt).toContain('priez pour moi');
    expect(write.prompt).toContain('Louis Segond');
    expect(write.prompt).toContain('spoken in French');
  });

  it('transcribeAndTranslateAudio returns an empty result for a silent recording, without a second call', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = mockAudioGemini({ detectedLanguage: 'en', transcript: '  ' }, {});
    expect(await translation.transcribeAndTranslateAudio('ZmFrZQ==', 'audio/webm')).toEqual({ detectedLanguage: 'en', transcript: '', translatedTranscript: '' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('transcribeAndTranslateAudio gives up (null) when the writing step fails, so it is retried later', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    mockAudioGemini({ detectedLanguage: 'en', transcript: 'God is good' }, { transcript: '', translated: '' });
    expect(await translation.transcribeAndTranslateAudio('ZmFrZQ==', 'audio/webm')).toBeNull();
  });

  it('uses the stronger model for the wording and falls back to the light one when it is not available', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key', GEMINI_QUALITY_MODEL: 'strong-model' });
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('strong-model')) return { ok: false, status: 429, text: async () => 'quota' };
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'en', translated: 'Bonjour' }) }] } }] }) };
      }),
    );
    expect(await translation.translateText('Hello')).toEqual({ detectedLanguage: 'en', translatedBody: 'Bonjour' });
    expect(urls[0]).toContain('strong-model');
    expect(urls[1]).toContain('gemini-flash-lite-latest');

    urls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'en', translated: 'Salut' }) }] } }] }) };
      }),
    );
    expect(await translation.translateText('Hi')).toEqual({ detectedLanguage: 'en', translatedBody: 'Salut' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('strong-model');
  });

  it('tells the translator who is speaking and asks for natural French with Louis Segond verses', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'en', translated: 'x' }) }] } }] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    await translation.translateText('God is good');
    const sent = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body).contents[0].parts[0].text as string;
    expect(sent).toContain('Pentecostal');
    expect(sent).toContain('Louis Segond');
    expect(sent).toContain('never word for word');
  });

  it('transcribeAndTranslateAudio skips the call entirely for an oversized audio payload', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // ~25MB of base64 text — comfortably over the 15MB inline cutoff.
    const huge = 'A'.repeat(25 * 1024 * 1024);
    expect(await translation.transcribeAndTranslateAudio(huge, 'audio/webm')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('translateAndStoreUpdatePost stores the translation on the post once it resolves', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    mockGeminiResponse({ detectedLanguage: 'fr', translated: 'Praise God' });

    const author = await prisma.person.create({ data: { name: 'Translation Author', whatsappNumber: '+237699300001' } });
    const post = await prisma.updatePost.create({ data: { authorPersonId: author.id, body: 'Louons Dieu' } });

    await translation.translateAndStoreUpdatePost(post.id, 'Louons Dieu');

    const stored = await prisma.updatePost.findUnique({ where: { id: post.id } });
    expect(stored?.detectedLanguage).toBe('fr');
    expect(stored?.translatedBody).toBe('Praise God');
    expect(stored?.translatedAt).toBeTruthy();
  });

  it('translateAndStoreUpdatePost leaves the post untouched when the Gemini call fails', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));

    const author = await prisma.person.create({ data: { name: 'Translation Author 2', whatsappNumber: '+237699300002' } });
    const post = await prisma.updatePost.create({ data: { authorPersonId: author.id, body: 'Louons Dieu encore' } });

    await expect(translation.translateAndStoreUpdatePost(post.id, 'Louons Dieu encore')).resolves.toBeUndefined();

    const stored = await prisma.updatePost.findUnique({ where: { id: post.id } });
    expect(stored?.detectedLanguage).toBeNull();
    expect(stored?.translatedBody).toBeNull();
  });

  it('translateAndStoreMessage stores the translation on the message once it resolves', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    mockGeminiResponse({ detectedLanguage: 'en', translated: 'Dieu est bon' });

    const sender = await prisma.person.create({ data: { name: 'Translation Sender', whatsappNumber: '+237699300003' } });
    const community = await prisma.community.create({ data: { name: 'Translation Community' } });
    const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'God is good' } });

    await translation.translateAndStoreMessage(message.id, 'God is good');

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored?.detectedLanguage).toBe('en');
    expect(stored?.translatedBody).toBe('Dieu est bon');
  });

  it('transcribeAndStoreMessageAudio downloads the object, transcribes it, and stores the result', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    vi.mocked(storage.getObjectStream).mockResolvedValueOnce({
      body: Readable.from([Buffer.from('fake-audio-bytes')]),
      contentLength: 17,
    });
    mockAudioGemini({ detectedLanguage: 'fr', transcript: 'merci seigneur' }, { transcript: 'Merci Seigneur', translated: 'Thank you Lord' });

    const sender = await prisma.person.create({ data: { name: 'Transcribe Sender', whatsappNumber: '+237699300004' } });
    const community = await prisma.community.create({ data: { name: 'Transcribe Community' } });
    const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: null } });

    await translation.transcribeAndStoreMessageAudio(message.id, 'communities/x/attachments/voice', 'audio/webm');

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored?.transcribedLanguage).toBe('fr');
    expect(stored?.transcribedBody).toBe('Merci Seigneur');
    expect(stored?.translatedTranscript).toBe('Thank you Lord');
    expect(stored?.transcribedAt).toBeTruthy();
  });

  it('transcribeAndStoreMessageAudio leaves the message untouched when the object is missing from storage', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    vi.mocked(storage.getObjectStream).mockResolvedValueOnce(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const sender = await prisma.person.create({ data: { name: 'Transcribe Sender 2', whatsappNumber: '+237699300005' } });
    const community = await prisma.community.create({ data: { name: 'Transcribe Community 2' } });
    const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: null } });

    await translation.transcribeAndStoreMessageAudio(message.id, 'communities/x/attachments/missing', 'audio/webm');

    expect(fetchSpy).not.toHaveBeenCalled();
    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored?.transcribedLanguage).toBeNull();
  });
});
