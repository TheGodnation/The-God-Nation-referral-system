import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../lib/storage', () => ({
  getObjectStream: vi.fn(async () => null),
  putObject: vi.fn(async () => {}),
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

/** A Gemini TTS-shaped response: raw PCM audio as base64 inlineData. */
function ttsResponse(pcmBase64: string, mimeType = 'audio/L16;rate=24000') {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: pcmBase64 } }] } }] }) };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lib/translation — Gemini-backed text translation and voice-note transcription', () => {
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

  it('translateText returns null if the response is malformed (bad language, missing field)', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    mockGeminiResponse({ detectedLanguage: 'es', translated: 'Buenos días' });
    expect(await translation.translateText('Bonjour')).toBeNull();
  });

  it('transcribeAndTranslateAudio transcribes and translates in one call, sending the audio inline', async () => {
    const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string);
      expect(payload.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/webm', data: 'ZmFrZS1hdWRpbw==' });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'fr', transcript: 'Priez pour moi', translated: 'Pray for me' }) }] } }] }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await translation.transcribeAndTranslateAudio('ZmFrZS1hdWRpbw==', 'audio/webm');
    expect(result).toEqual({ detectedLanguage: 'fr', transcript: 'Priez pour moi', translatedTranscript: 'Pray for me' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    mockGeminiResponse({ detectedLanguage: 'fr', transcript: 'Merci Seigneur', translated: 'Thank you Lord' });

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

  describe('synthesizeSpeech — voice-to-voice', () => {
    it('wraps Gemini\'s raw PCM audio in a WAV header so it is directly playable', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      const pcm = Buffer.from([1, 2, 3, 4]);
      vi.stubGlobal('fetch', vi.fn(async () => ttsResponse(pcm.toString('base64'))));

      const result = await translation.synthesizeSpeech('Pray for me');
      expect(result?.mimeType).toBe('audio/wav');
      expect(result?.audio.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(result?.audio.subarray(8, 12).toString('ascii')).toBe('WAVE');
      // The header is 44 bytes; the original PCM bytes follow untouched.
      expect(result?.audio.subarray(44)).toEqual(pcm);
    });

    it('passes through an already-containerized response untouched', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      const fakeMp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
      vi.stubGlobal('fetch', vi.fn(async () => ttsResponse(fakeMp3.toString('base64'), 'audio/mpeg')));

      const result = await translation.synthesizeSpeech('Pray for me');
      expect(result).toEqual({ audio: fakeMp3, mimeType: 'audio/mpeg' });
    });

    it('returns null for empty text, without calling Gemini', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      expect(await translation.synthesizeSpeech('   ')).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null if Gemini TTS responds with a non-OK status', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => 'model not found' })));
      expect(await translation.synthesizeSpeech('Pray for me')).toBeNull();
    });

    it('asks Gemini\'s ListModels endpoint for the real TTS model name when the model itself 404s', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'model not found' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
            ],
          }),
        });
      vi.stubGlobal('fetch', fetchSpy);

      expect(await translation.synthesizeSpeech('Pray for me')).toBeNull();
      // synthesizeSpeech's own call returns before the fire-and-forget
      // ListModels lookup's promise necessarily settles — give it a tick.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [, [listModelsUrl]] = fetchSpy.mock.calls;
      expect(listModelsUrl).toContain('/v1beta/models?pageSize=200&key=test-key');
    });

    it('does not call ListModels for a non-404 failure', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      const fetchSpy = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'server error' }));
      vi.stubGlobal('fetch', fetchSpy);
      expect(await translation.synthesizeSpeech('Pray for me')).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null if the response has no audio data', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'no audio here' }] } }] }) })));
      expect(await translation.synthesizeSpeech('Pray for me')).toBeNull();
    });
  });

  describe('transcribeAndStoreMessageAudio — voice-to-voice follow-up', () => {
    it('also synthesizes the translated transcript as audio and stores it alongside the transcript', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      vi.mocked(storage.getObjectStream).mockResolvedValueOnce({
        body: Readable.from([Buffer.from('fake-audio-bytes')]),
        contentLength: 17,
      });
      const pcm = Buffer.from([9, 9, 9, 9]);
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'fr', transcript: 'Merci', translated: 'Thank you' }) }] } }] }) })
        .mockResolvedValueOnce(ttsResponse(pcm.toString('base64')));
      vi.stubGlobal('fetch', fetchSpy);

      const sender = await prisma.person.create({ data: { name: 'V2V Sender', whatsappNumber: '+237699300010' } });
      const community = await prisma.community.create({ data: { name: 'V2V Community' } });
      const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
      const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: null } });

      await translation.transcribeAndStoreMessageAudio(message.id, community.id, 'communities/x/attachments/voice', 'audio/webm');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(vi.mocked(storage.putObject)).toHaveBeenCalledTimes(1);
      const [[putArgs]] = vi.mocked(storage.putObject).mock.calls;
      expect(putArgs.storageKey).toMatch(new RegExp(`^communities/${community.id}/attachments/[0-9a-f-]{36}$`));
      expect(putArgs.contentType).toBe('audio/wav');

      const stored = await prisma.message.findUnique({ where: { id: message.id } });
      expect(stored?.translatedAudioStorageKey).toBe(putArgs.storageKey);
      expect(stored?.translatedAudioMimeType).toBe('audio/wav');
      // Spoken in French, so the synthesized audio is the English translation.
      expect(stored?.translatedAudioLanguage).toBe('en');
      expect(stored?.translatedAudioAt).toBeTruthy();
    });

    it('keeps the transcript even when speech synthesis itself fails', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      vi.mocked(storage.getObjectStream).mockResolvedValueOnce({
        body: Readable.from([Buffer.from('fake-audio-bytes')]),
        contentLength: 17,
      });
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'fr', transcript: 'Merci', translated: 'Thank you' }) }] } }] }) })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'tts down' });
      vi.stubGlobal('fetch', fetchSpy);

      const sender = await prisma.person.create({ data: { name: 'V2V Sender 2', whatsappNumber: '+237699300011' } });
      const community = await prisma.community.create({ data: { name: 'V2V Community 2' } });
      const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
      const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: null } });

      await translation.transcribeAndStoreMessageAudio(message.id, community.id, 'communities/x/attachments/voice', 'audio/webm');

      expect(vi.mocked(storage.putObject)).not.toHaveBeenCalled();
      const stored = await prisma.message.findUnique({ where: { id: message.id } });
      expect(stored?.transcribedBody).toBe('Merci');
      expect(stored?.translatedAudioStorageKey).toBeNull();
    });

    it('never records translatedAudio fields when storage write itself fails', async () => {
      const translation = await freshTranslationModule({ GEMINI_API_KEY: 'test-key' });
      vi.mocked(storage.getObjectStream).mockResolvedValueOnce({
        body: Readable.from([Buffer.from('fake-audio-bytes')]),
        contentLength: 17,
      });
      vi.mocked(storage.putObject).mockRejectedValueOnce(new Error('R2 unavailable'));
      const pcm = Buffer.from([9, 9, 9, 9]);
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'en', transcript: 'Thanks', translated: 'Merci' }) }] } }] }) })
        .mockResolvedValueOnce(ttsResponse(pcm.toString('base64')));
      vi.stubGlobal('fetch', fetchSpy);

      const sender = await prisma.person.create({ data: { name: 'V2V Sender 3', whatsappNumber: '+237699300012' } });
      const community = await prisma.community.create({ data: { name: 'V2V Community 3' } });
      const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
      const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: null } });

      await translation.transcribeAndStoreMessageAudio(message.id, community.id, 'communities/x/attachments/voice', 'audio/webm');

      const stored = await prisma.message.findUnique({ where: { id: message.id } });
      expect(stored?.transcribedBody).toBe('Thanks');
      expect(stored?.translatedAudioStorageKey).toBeNull();
    });
  });
});
