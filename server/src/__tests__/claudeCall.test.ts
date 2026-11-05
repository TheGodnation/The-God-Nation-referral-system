import { describe, it, expect, vi, afterEach } from 'vitest';

// The real Anthropic SDK call, with the network stubbed by a minimal server-sent-events answer.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
});

function sse(text: string, stopReason = 'end_turn') {
  const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const body =
    ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }) +
    ev('message_stop', { type: 'message_stop' });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const schema = { type: 'object', properties: { translated: { type: 'string' } }, required: ['translated'] };

describe('callClaudeJson', () => {
  it('sends the prompt with a closed JSON schema to claude-opus-5-5 and returns the parsed answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    vi.resetModules();
    let sent: any = null;
    let headers: Headers | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      headers = new Headers(init.headers);
      return sse('{"translated":"Bonjour"}');
    }));
    const { callClaudeJson } = await import('../lib/claude');
    expect(await callClaudeJson('Translate: Hello', schema)).toEqual({ translated: 'Bonjour' });
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.messages).toEqual([{ role: 'user', content: 'Translate: Hello' }]);
    expect(sent.output_config.format).toMatchObject({ type: 'json_schema', schema: { additionalProperties: false } });
    expect(sent.stream).toBe(true);
    expect(headers!.get('x-api-key') ?? headers!.get('authorization')).toMatch(/sk-test/);
  });

  it('gives null (so Gemini takes over) when Claude refuses, is cut off, or the network fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { callClaudeJson } = await import('../lib/claude');
    vi.stubGlobal('fetch', vi.fn(async () => sse('{"translated":"x"}', 'refusal')));
    expect(await callClaudeJson('p', schema)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => sse('{"translated":"x', 'max_tokens')));
    expect(await callClaudeJson('p', schema)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await callClaudeJson('p', schema, { timeoutMs: 2000 })).toBeNull();
  });

  it('does nothing without a key', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { callClaudeJson, isClaudeConfigured } = await import('../lib/claude');
    expect(isClaudeConfigured()).toBe(false);
    expect(await callClaudeJson('p', schema)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
