import { describe, it, expect, vi, afterEach } from 'vitest';

// Claude is asked first for text jobs when ANTHROPIC_API_KEY is set; Gemini is the fallback, and still the only
// one that hears audio.
const claudeJson = vi.fn();
vi.mock('../lib/claude', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/claude')>();
  return { ...real, isClaudeConfigured: () => true, callClaudeJson: (...a: unknown[]) => claudeJson(...a) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  claudeJson.mockReset();
  delete process.env.GEMINI_API_KEY;
});

function geminiOk(json: unknown) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), text: async () => '' };
}

describe('Claude first, Gemini as the fallback', () => {
  it('translates with Claude and never calls Gemini when Claude answers', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    claudeJson.mockResolvedValue({ detectedLanguage: 'en', translated: 'Bonjour' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { translateText } = await import('../lib/translation');
    expect(await translateText('Hello')).toEqual({ detectedLanguage: 'en', translatedBody: 'Bonjour' });
    expect(claudeJson).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to Gemini when Claude gives nothing', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    claudeJson.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => geminiOk({ detectedLanguage: 'en', translated: 'Salut' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { translateText } = await import('../lib/translation');
    expect(await translateText('Hi')).toEqual({ detectedLanguage: 'en', translatedBody: 'Salut' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('sends audio only to Gemini (Claude is not asked for the listening step)', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    claudeJson.mockResolvedValue({ transcript: 'God is good', translated: 'Dieu est bon' });
    const fetchMock = vi.fn(async () => geminiOk({ detectedLanguage: 'en', transcript: 'God is good' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { transcribeAndTranslateAudio } = await import('../lib/translation');
    await transcribeAndTranslateAudio('ZmFrZQ==', 'audio/webm');
    // The listening step is audio: Gemini heard it; the writing-out step is text: Claude was asked.
    expect(fetchMock).toHaveBeenCalled();
    expect(claudeJson).toHaveBeenCalledTimes(1);
  });

  it('drafts quiz questions with Claude first', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    claudeJson.mockResolvedValue({ questions: [{ textEn: 'Q?', textFr: 'Q ?', options: [{ textEn: 'a', textFr: 'a' }, { textEn: 'b', textFr: 'b' }], correctIndex: 0 }] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { callGeminiPersistent } = await import('../lib/translation');
    const res = await callGeminiPersistent([{ role: 'user', parts: [{ text: 'Write questions' }] }], {}, {});
    expect(res.questions).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('claude helpers', () => {
  it('closeSchema closes every object and requires its fields', async () => {
    const { closeSchema, textOnlyPrompt } = await import('../lib/claude');
    const closed = closeSchema({ type: 'object', properties: { a: { type: 'string' }, list: { type: 'array', items: { type: 'object', properties: { b: { type: 'string' } } } } } });
    expect(closed.additionalProperties).toBe(false);
    expect(closed.required).toEqual(['a', 'list']);
    expect(closed.properties.list.items.additionalProperties).toBe(false);
    expect(textOnlyPrompt([{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }])).toBe('a\n\nb');
    expect(textOnlyPrompt([{ role: 'user', parts: [{ text: 'a' }, { inlineData: { data: 'x' } }] }])).toBeNull();
  });
});
