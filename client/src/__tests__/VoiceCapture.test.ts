import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { VOICE_BITRATE, chatBitrate, enhanceMic, openMic, teachingBitrate } from '../lib/voiceCapture';
import { setVoiceProcessing } from '../lib/voiceSettings';

// Recording a clear, loud voice note: the phone's voice clean-up is asked for, the quality is better than before, the voice is evened
// out and limited before it is recorded, and a phone that cannot do any of that still records as it always did.
afterEach(() => {
  vi.unstubAllGlobals();
  setVoiceProcessing(false);
});

const track = { kind: 'audio' } as MediaStreamTrack;
const rawStream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;

function mic(impl: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}

describe('as things are in the app now (the sound tuning is switched off)', () => {
  it('records the plain microphone (no processing of its own) at 64 kbps, for chats and teachings alike', async () => {
    const gum = mic(async () => rawStream);
    expect(await openMic()).toBe(rawStream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum.mock.calls[0][0]).toEqual({ audio: true });
    expect(chatBitrate()).toBe(64_000);
    expect(teachingBitrate()).toBe(64_000);
  });

  it('does no audio processing even where the phone could', () => {
    const made = vi.fn();
    vi.stubGlobal('AudioContext', class {
      constructor() {
        made();
      }
    });
    expect(enhanceMic(rawStream).stream).toBe(rawStream);
    expect(made).not.toHaveBeenCalled();
  });

  it('still passes on a refusal to use the microphone', async () => {
    mic(async () => {
      throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
    });
    await expect(openMic()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('with the sound tuning switched on (for when it is worked on again)', () => {
  beforeEach(() => setVoiceProcessing(true));
  it('uses the same quality', () => {
    expect(chatBitrate()).toBe(VOICE_BITRATE);
    expect(teachingBitrate()).toBe(VOICE_BITRATE);
  });
});

describe('opening the microphone', () => {
  beforeEach(() => setVoiceProcessing(true));
  it('asks for noise reduction, echo control, automatic gain and one channel', async () => {
    const gum = mic(async () => rawStream);
    expect(await openMic()).toBe(rawStream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum.mock.calls[0][0]).toEqual({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  });

  it('falls back to the plain microphone on a phone that does not know those settings', async () => {
    const gum = mic(async (c) => {
      if (typeof c.audio === 'object') throw Object.assign(new Error('x'), { name: 'OverconstrainedError' });
      return rawStream;
    });
    expect(await openMic()).toBe(rawStream);
    expect(gum).toHaveBeenCalledTimes(2);
    expect(gum.mock.calls[1][0]).toEqual({ audio: true });
  });

  it('passes on a refusal to use the microphone, without asking again', async () => {
    const gum = mic(async () => {
      throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
    });
    await expect(openMic()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it('records speech at 64 kbps, better than the 32 kbps used before', () => {
    expect(VOICE_BITRATE).toBe(64_000);
  });
});

describe('cleaning up the voice before it is recorded', () => {
  beforeEach(() => setVoiceProcessing(true));
  it('records the plain microphone when the phone has no audio processing', () => {
    vi.stubGlobal('AudioContext', undefined);
    const out = enhanceMic(rawStream);
    expect(out.stream).toBe(rawStream);
    expect(() => out.close()).not.toThrow();
  });

  it('records the plain microphone when setting the processing up fails', () => {
    vi.stubGlobal('AudioContext', class {
      constructor() {
        throw new Error('blocked');
      }
    });
    expect(enhanceMic(rawStream).stream).toBe(rawStream);
  });

  it('runs the voice through a rumble filter, a hiss filter, warmth and softening, a noise gate, a compressor, a small make-up gain and a limiter, and records the result', () => {
    const connections: string[] = [];
    const node = (name: string, extra: object = {}) => ({ connect: vi.fn((to: { __name?: string }) => connections.push(`${name}>${to.__name}`)), __name: name, ...extra });
    const param = (value = 0) => ({ value });
    const closed = vi.fn(async () => {});
    const resumed = vi.fn(async () => {});
    const outStream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const compressors: ReturnType<typeof node>[] = [];
    const gains: { gain: { value: number; cancelScheduledValues: ReturnType<typeof vi.fn> } }[] = [];
    const filters: { type: string; frequency: { value: number }; gain: { value: number } }[] = [];
    vi.stubGlobal('AudioContext', class {
      state = 'suspended';
      currentTime = 0;
      resume = resumed;
      close = closed;
      createMediaStreamSource() {
        return node('source');
      }
      createBiquadFilter() {
        const n = node(['rumble', 'hiss', 'warmth', 'soften'][filters.length], { type: '', frequency: param(), gain: param() });
        filters.push(n as unknown as (typeof filters)[number]);
        return n;
      }
      createAnalyser() {
        return node('listener', { fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) });
      }
      createDelay() {
        return node('delay', { delayTime: param() });
      }
      createDynamicsCompressor() {
        const n = node(compressors.length === 0 ? 'compressor' : 'limiter', { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
        compressors.push(n);
        return n;
      }
      createGain() {
        const n = node(gains.length === 0 ? 'makeup' : 'gate', { gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } });
        gains.push(n as unknown as (typeof gains)[number]);
        return n;
      }
      createMediaStreamDestination() {
        return { __name: 'out', stream: outStream };
      }
    });
    vi.useFakeTimers();
    const out = enhanceMic(rawStream);
    expect(out.stream).toBe(outStream);
    expect(connections).toEqual([
      'source>rumble',
      'rumble>hiss',
      'hiss>warmth',
      'warmth>soften',
      'soften>listener', // the gate listens to the voice...
      'soften>delay', // ...while the voice itself is delayed a little...
      'delay>gate', // ...so the gate can open before a word arrives
      'gate>compressor',
      'compressor>makeup',
      'makeup>limiter',
      'limiter>out',
    ]);
    // Only the real rumble and the very high hiss are cut; the lower voice gets a lift (body, weight) and the harsh highs are softened.
    expect(filters.map((f) => f.frequency.value)).toEqual([75, 6000, 220, 3500]);
    expect(filters.map((f) => f.gain.value).slice(2)).toEqual([4, -4]);
    // Only a small lift: more would lift the background noise with it.
    expect(gains[0].gain.value).toBeGreaterThan(1);
    expect(gains[0].gain.value).toBeLessThanOrEqual(1.5);
    const limiter = compressors[1] as unknown as { threshold: { value: number }; ratio: { value: number } };
    expect(limiter.threshold.value).toBeLessThan(0); // never reaches the top, so it cannot crackle
    expect(limiter.ratio.value).toBe(20);
    expect(resumed).toHaveBeenCalled();
    // The noise gate is listening while recording, and let go of at the end.
    vi.advanceTimersByTime(60);
    expect(gains[1].gain.cancelScheduledValues).toHaveBeenCalled();
    out.close();
    expect(closed).toHaveBeenCalled();
    const checks = gains[1].gain.cancelScheduledValues.mock.calls.length;
    vi.advanceTimersByTime(200);
    expect(gains[1].gain.cancelScheduledValues.mock.calls.length).toBe(checks); // no more checks
    vi.useRealTimers();
  });
});

describe('when the microphone cannot be opened, the member is told the real reason', () => {
  const err = (name: string) => Object.assign(new Error(name), { name });

  it('tries once more, a moment later, when the microphone is only busy', async () => {
    let n = 0;
    const gum = mic(async () => {
      n += 1;
      if (n === 1) throw err('NotReadableError');
      return rawStream;
    });
    expect(await openMic()).toBe(rawStream);
    expect(gum).toHaveBeenCalledTimes(2);
  });

  it('does not ask again after a refusal', async () => {
    const gum = mic(async () => {
      throw err('NotAllowedError');
    });
    await expect(openMic()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it('names each kind of problem: refused, busy (a call or another app), no microphone, or something else', async () => {
    const { micProblem, micProblemKey } = await import('../lib/voiceCapture');
    expect(micProblem(err('NotAllowedError'))).toBe('denied');
    expect(micProblem(err('SecurityError'))).toBe('denied');
    expect(micProblem(err('NotReadableError'))).toBe('busy');
    expect(micProblem(err('AbortError'))).toBe('busy');
    expect(micProblem(err('NotFoundError'))).toBe('none');
    expect(micProblem(new Error('strange'))).toBe('other');
    expect(micProblemKey('denied')).toBe('groupChat.mic_denied');
    expect(micProblemKey('busy')).toBe('groupChat.mic_busy');
    expect(micProblemKey('none')).toBe('groupChat.mic_none');
    expect(micProblemKey('other')).toBe('groupChat.mic_other');
  });

  it('inside another app’s browser (a link opened in WhatsApp), a refusal says to open it in Chrome or the installed app', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 13) WhatsApp/2.24');
    const { micProblemKey } = await import('../lib/voiceCapture');
    expect(micProblemKey('denied')).toBe('groupChat.mic_in_app');
    ua.mockRestore();
  });
});

describe('double-checking a blocked microphone with the browser’s own permission', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  });
  const err = (name: string) => Object.assign(new Error(name), { name });

  it('treats any error as "blocked" when the browser says the permission is denied (some browsers use another name for it)', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'denied' }) } });
    const { explainMicProblem } = await import('../lib/voiceCapture');
    expect(await explainMicProblem(err('NotSupportedError'))).toEqual({ problem: 'denied', permission: 'denied' });
  });

  it('keeps the error’s own reason when the permission is not denied, or cannot be checked', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } });
    const { explainMicProblem } = await import('../lib/voiceCapture');
    expect(await explainMicProblem(err('NotReadableError'))).toEqual({ problem: 'busy', permission: 'granted' });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    expect(await explainMicProblem(err('NotFoundError'))).toEqual({ problem: 'none', permission: null });
  });
});
