import Anthropic from '@anthropic-ai/sdk';

// Claude as the first choice for the jobs that are only text: translating posts, chat messages and teachings
// (and writing the voice-note text out well), and drafting quiz questions. When ANTHROPIC_API_KEY is not set,
// or Claude gives nothing, the callers fall back to Gemini exactly as before (see translation.ts). Audio is
// never sent here: Claude does not take audio, so a voice note is still listened to by Gemini.
//
// Private messages and prayer requests never reach this file either: nothing in them calls translation.ts at all.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
// Opus is Anthropic's most capable model; ANTHROPIC_MODEL can point at another (for example claude-sonnet-5-5 to cost less).
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const DEFAULT_TIMEOUT_MS = 90000;

let client: Anthropic | null = null;
let warnedUnconfigured = false;

export function isClaudeConfigured(): boolean {
  return Boolean(ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 1 });
  return client;
}

/** The structured-output format wants every object closed (no extra fields) and its fields listed as required. */
export function closeSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(closeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [key, value] of Object.entries(schema)) out[key] = closeSchema(value);
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    if (!Array.isArray(out.required)) out.required = Object.keys(out.properties);
  }
  return out;
}

/**
 * Asks Claude for JSON that follows `schema` (the same JSON-schema objects Gemini is given). Returns the parsed
 * object, or null when Claude is not set up or could not answer (network, overloaded, refused, cut off) — never throws.
 */
export async function callClaudeJson(prompt: string, schema: unknown, opts: { timeoutMs?: number } = {}): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[claude] ANTHROPIC_API_KEY not configured — using Gemini only');
    }
    return null;
  }
  try {
    const message = await getClient()
      .messages.stream(
        {
          model: CLAUDE_MODEL,
          max_tokens: 32000,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: { type: 'json_schema', schema: closeSchema(schema) } },
        },
        { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      )
      .finalMessage();
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
      console.error('[claude] no usable answer', { stopReason: message.stop_reason });
      return null;
    }
    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      console.error('[claude] the answer had no text');
      return null;
    }
    return JSON.parse(block.text);
  } catch (err) {
    console.error('[claude] call failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The plain text of a Gemini-style `contents` list, or null when it carries anything else (audio, images). */
export function textOnlyPrompt(contents: unknown[]): string | null {
  const texts: string[] = [];
  for (const item of contents as Array<{ parts?: Array<Record<string, unknown>> }>) {
    for (const part of item?.parts ?? []) {
      if (typeof part.text === 'string' && Object.keys(part).length === 1) texts.push(part.text);
      else return null;
    }
  }
  return texts.length ? texts.join('\n\n') : null;
}
