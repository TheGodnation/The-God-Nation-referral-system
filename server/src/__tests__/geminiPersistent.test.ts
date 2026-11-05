import { describe, it, expect, vi, afterEach } from 'vitest';

// When Google answers "high demand" (503), a job somebody is waiting on asks again — alternating
// models — instead of giving up after one try.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_QUALITY_MODEL;
});

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), text: async () => '' };
}
const busy = { ok: false, status: 503, json: async () => ({}), text: async () => 'high demand' };

describe('callGeminiPersistent', () => {
  it('keeps asking, on both models, until Gemini answers', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_QUALITY_MODEL = 'gemini-flash-latest';
    vi.resetModules();
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return urls.length < 3 ? busy : ok({ questions: ['x'] });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { callGeminiPersistent } = await import('../lib/translation');
    const res = await callGeminiPersistent([], {}, { pauseMs: 1 });
    expect(res).toEqual({ questions: ['x'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(urls[0]).toContain('gemini-flash-latest');
    expect(urls[1]).toContain('gemini-flash-lite-latest');
  });

  it('gives up with null only after every try failed', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    const fetchMock = vi.fn(async () => busy);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { callGeminiPersistent } = await import('../lib/translation');
    expect(await callGeminiPersistent([], {}, { tries: 3, pauseMs: 1 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
