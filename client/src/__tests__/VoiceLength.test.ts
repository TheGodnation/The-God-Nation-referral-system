import { describe, it, expect, vi, afterEach } from 'vitest';

// A voice note carries the length its recorder measured, and what this phone has just sent stays in memory for a while so the
// sender's own note is playable at once.
vi.mock('../lib/api', () => ({
  api: { post: vi.fn(async () => ({ storageKey: 'communities/c1/attachments/k1', uploadUrl: 'https://r2.example/up' })), get: vi.fn() },
  ApiError: class ApiError extends Error {
    status = 0;
  },
}));

import { findJustSent, noteVoiceLength, uploadChatFile, voiceLengthOf } from '../lib/chatMedia';

afterEach(() => vi.unstubAllGlobals());

const audio = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' });

describe('voice note length and the copy kept after sending', () => {
  it('remembers the recorded length against the file, and ignores a missing or silly one', () => {
    const f = audio(100);
    expect(voiceLengthOf(f)).toBeUndefined();
    noteVoiceLength(f, 7_250.4);
    expect(voiceLengthOf(f)).toBe(7_250);
    const g = audio(100);
    noteVoiceLength(g, 0);
    noteVoiceLength(g, Number.NaN);
    expect(voiceLengthOf(g)).toBeUndefined();
  });

  it('sends the length with the upload, and keeps the sent audio so it can play at once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const f = audio(4321);
    noteVoiceLength(f, 12_000);
    const up = await uploadChatFile('/api/x/authorize', f, 'voice-note.m4a');
    expect(up).toMatchObject({ mimeType: 'audio/mp4', byteSize: 4321, durationMs: 12_000 });
    expect(findJustSent(4321, 'audio/mp4')).not.toBeNull();
    // Not the same size or type: nothing is returned (so nobody else's note could be mistaken for it).
    expect(findJustSent(4322, 'audio/mp4')).toBeNull();
    expect(findJustSent(4321, 'audio/webm')).toBeNull();
  });

  it('an upload without a recorded length has none, and photos are not kept in memory', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const up = await uploadChatFile('/api/x/authorize', audio(777), 'voice-note.m4a');
    expect(up.durationMs).toBeUndefined();
    const photo = new Blob([new Uint8Array(999)], { type: 'image/jpeg' });
    await uploadChatFile('/api/x/authorize', photo, 'a.jpg');
    expect(findJustSent(999, 'image/jpeg')).toBeNull();
  });
});
