import { describe, it, expect, vi, afterEach } from 'vitest';
import { VOICE_BITRATE, enhanceMic, openMic } from '../lib/voiceCapture';

// Recording a clear, loud voice note: the phone's voice clean-up is asked for, the quality is better than before, the voice is evened
// out and limited before it is recorded, and a phone that cannot do any of that still records as it always did.
afterEach(() => vi.unstubAllGlobals());

const track = { kind: 'audio' } as MediaStreamTrack;
const rawStream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;

function mic(impl: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}

describe('opening the microphone', () => {
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

  it('runs the voice through a rumble filter, a compressor, make-up gain and a limiter, and records the result', () => {
    const connections: string[] = [];
    const node = (name: string, extra: object = {}) => ({ connect: vi.fn((to: { __name?: string }) => connections.push(`${name}>${to.__name}`)), __name: name, ...extra });
    const param = (value = 0) => ({ value });
    const closed = vi.fn(async () => {});
    const resumed = vi.fn(async () => {});
    const outStream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const compressors: ReturnType<typeof node>[] = [];
    const gains: { gain: { value: number } }[] = [];
    vi.stubGlobal('AudioContext', class {
      state = 'suspended';
      resume = resumed;
      close = closed;
      createMediaStreamSource() {
        return node('source');
      }
      createBiquadFilter() {
        return node('rumble', { type: '', frequency: param() });
      }
      createDynamicsCompressor() {
        const n = node(compressors.length === 0 ? 'compressor' : 'limiter', { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
        compressors.push(n);
        return n;
      }
      createGain() {
        const n = node('makeup', { gain: param(1) });
        gains.push(n as unknown as { gain: { value: number } });
        return n;
      }
      createMediaStreamDestination() {
        return { __name: 'out', stream: outStream };
      }
    });
    const out = enhanceMic(rawStream);
    expect(out.stream).toBe(outStream);
    expect(connections).toEqual(['source>rumble', 'rumble>compressor', 'compressor>makeup', 'makeup>limiter', 'limiter>out']);
    expect(gains[0].gain.value).toBeGreaterThan(1); // a little louder
    const limiter = compressors[1] as unknown as { threshold: { value: number }; ratio: { value: number } };
    expect(limiter.threshold.value).toBeLessThan(0); // never reaches the top, so it cannot crackle
    expect(limiter.ratio.value).toBe(20);
    expect(resumed).toHaveBeenCalled();
    out.close();
    expect(closed).toHaveBeenCalled();
  });
});
