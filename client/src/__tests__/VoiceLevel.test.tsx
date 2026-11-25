import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceNotePlayer } from '../components/chat/VoiceNotePlayer';
import { MAX_LIFT_DB, TARGET_SPEECH_DB, knownLift, levelBlocked, liftDb, measureNote, measureSpeech, resetLevelForTests, setLevelOn } from '../lib/voiceLevel';

// Even loudness: each voice note is measured once, a quiet one is lifted by one steady amount to the same level as the others, a loud
// one is left alone. No noise cleaner, no tone change. It must never leave a note silent: only hooked up from a tap, only when the
// storage is known to allow it, and with a way back to the ordinary playing.

const RATE = 16000;
/** Speech-like sound: bursts of a tone at `amp`, with silent pauses between them. */
function speech(amp: number, seconds = 2): Float32Array {
  const out = new Float32Array(RATE * seconds);
  for (let i = 0; i < out.length; i++) {
    const inWord = Math.floor(i / (RATE * 0.3)) % 2 === 0;
    out[i] = inWord ? amp * Math.sin((2 * Math.PI * 200 * i) / RATE) : 0;
  }
  return out;
}
const dbOf = (amp: number) => 20 * Math.log10(amp / Math.SQRT2); // a sine's loudness

describe('measuring a note', () => {
  it('measures the speaking and leaves the pauses out', () => {
    const m = measureSpeech(speech(0.1), RATE);
    expect(m.speechDb).toBeCloseTo(dbOf(0.1), 0);
    expect(m.peak).toBeCloseTo(0.1, 2);
  });

  it('a silent note has no speech level and is not lifted', () => {
    const m = measureSpeech(new Float32Array(RATE), RATE);
    expect(m.speechDb).toBeNull();
    expect(liftDb(m)).toBe(0);
  });

  it('lifts a quiet note up to the common level', () => {
    const m = measureSpeech(speech(0.05), RATE); // about -29 dB
    expect(liftDb(m)).toBeCloseTo(TARGET_SPEECH_DB - dbOf(0.05), 0);
  });

  it('leaves a note that is already loud enough exactly as it is (never turns it down)', () => {
    expect(liftDb(measureSpeech(speech(0.5), RATE))).toBe(0);
  });

  it('never lifts more than the maximum, however quiet', () => {
    expect(liftDb(measureSpeech(speech(0.01), RATE))).toBe(MAX_LIFT_DB);
  });

  it('holds the lift back when the peaks would crackle', () => {
    // Quiet speaking but with loud bursts in it: the lift stops where the bursts would go over the top (plus the limiter's allowance).
    const s = speech(0.05);
    for (let i = 0; i < s.length; i += RATE / 4) for (let j = 0; j < 800; j++) s[i + j] = 0.7 * Math.sin(j / 3);
    const m = measureSpeech(s, RATE);
    expect(liftDb(m)).toBeLessThanOrEqual(3 - 20 * Math.log10(m.peak) + 1e-9);
  });
});

// --- The player ---------------------------------------------------------------------------------------------------------------

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = {};
  currentTime = 0;
  sources: unknown[] = [];
  gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  compressors: { threshold: { value: number }; ratio: { value: number } }[] = [];
  filters = 0;
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  constructor() {
    FakeAudioContext.last = this;
  }
  createMediaElementSource() {
    const node = { connect: vi.fn() };
    this.sources.push(node);
    return node;
  }
  createGain() {
    const node = { gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }, connect: vi.fn() };
    this.gains.push(node);
    return node;
  }
  createBiquadFilter() {
    this.filters += 1;
    return { connect: vi.fn() };
  }
  createDynamicsCompressor() {
    const node = { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn() };
    this.compressors.push(node);
    return node;
  }
}

let decoded: Float32Array = speech(0.05);
class FakeOfflineAudioContext {
  sampleRate: number;
  constructor(_c: number, _l: number, rate: number) {
    this.sampleRate = rate;
  }
  decodeAudioData(_d: ArrayBuffer) {
    return Promise.resolve({ sampleRate: RATE, getChannelData: () => decoded });
  }
}

const props = { url: 'https://files.example/voice.m4a', byteSize: 400_000, durationMs: 60_000, seedId: 'a1', avatarName: 'Ben Tabe', own: false, waitForTap: false, failed: false, onRequestDownload: vi.fn() };
const fetchOk = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});
beforeEach(() => {
  window.localStorage.clear();
  resetLevelForTests();
  setLevelOn(true); // these tests are about the even loudness, which is switched off in the app for now
  FakeAudioContext.last = null;
  decoded = speech(0.05);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLevelOn(false);
});

const audio = () => document.querySelector('audio')!;
const play = () => fireEvent.click(screen.getByRole('button', { name: /Play voice message|Pause voice message/ }));
const liftOf = (db: number) => Math.pow(10, db / 20);

describe('Even loudness on a voice note', () => {
  it('is switched off in the app for now: notes play the plain way even on a phone that could do it', () => {
    setLevelOn(false);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    render(<VoiceNotePlayer {...props} />);
    expect(audio()).not.toHaveAttribute('crossorigin');
    fireEvent.loadedMetadata(audio());
    play();
    expect(FakeAudioContext.last).toBeNull(); // no audio processing is even started
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('a phone that cannot do it plays the ordinary way, fetching the audio the ordinary way', () => {
    render(<VoiceNotePlayer {...props} />);
    expect(audio()).not.toHaveAttribute('crossorigin');
    play();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('has no button: it is automatic', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    render(<VoiceNotePlayer {...props} />);
    expect(screen.queryByTestId('voice-boost')).toBeNull();
  });

  describe('on a phone that can', () => {
    beforeEach(() => {
      vi.stubGlobal('AudioContext', FakeAudioContext);
      vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
      vi.stubGlobal('fetch', fetchOk());
    });

    it('hooks the note up once, from the tap that plays it, and lifts a quiet note smoothly once it is measured', async () => {
      render(<VoiceNotePlayer {...props} />);
      expect(audio()).toHaveAttribute('crossorigin', 'anonymous');
      fireEvent.loadedMetadata(audio()); // it loaded the way the levelling needs
      expect(FakeAudioContext.last).toBeNull(); // nothing is started before a tap
      play();
      const ctx = FakeAudioContext.last!;
      expect(ctx.resume).toHaveBeenCalled();
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.gains[0].gain.value).toBe(1); // untouched until measured
      const expected = TARGET_SPEECH_DB - dbOf(0.05);
      await waitFor(() => expect(ctx.gains[0].gain.setTargetAtTime).toHaveBeenCalled());
      expect(ctx.gains[0].gain.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(liftOf(expected), 1);
      // Nothing else is done to the voice: no filters, and only the safety limiter.
      expect(ctx.filters).toBe(0);
      expect(ctx.compressors).toHaveLength(1);
      expect(ctx.compressors[0]).toMatchObject({ threshold: { value: -1 }, ratio: { value: 20 } });
      fireEvent.play(audio());
      play(); // pause and play again: no second hook-up
      play();
      expect(ctx.sources).toHaveLength(1);
    });

    it('a loud note is left exactly as it is', async () => {
      decoded = speech(0.5);
      render(<VoiceNotePlayer {...props} />);
      fireEvent.loadedMetadata(audio());
      play();
      const ctx = FakeAudioContext.last!;
      await waitFor(() => expect(ctx.gains[0].gain.setTargetAtTime).toHaveBeenCalled());
      expect(ctx.gains[0].gain.setTargetAtTime.mock.calls[0][0]).toBe(1);
    });

    it('measures each note only once, and starts straight at the remembered lift next time', async () => {
      const f = fetchOk();
      vi.stubGlobal('fetch', f);
      const first = await measureNote('a1', props.url);
      expect(knownLift('a1')).toBe(first);
      render(<VoiceNotePlayer {...props} />);
      fireEvent.loadedMetadata(audio());
      play();
      expect(FakeAudioContext.last!.gains[0].gain.value).toBeCloseTo(liftOf(first), 5);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it('waits for the audio to be known to load the right way, so a tap before that plays it untouched rather than risk silence', () => {
      render(<VoiceNotePlayer {...props} />);
      play(); // metadata has not loaded yet
      expect(FakeAudioContext.last?.sources ?? []).toHaveLength(0);
      fireEvent.loadedMetadata(audio());
      fireEvent.pause(audio());
      play(); // the next tap hooks it up
      expect(FakeAudioContext.last!.sources).toHaveLength(1);
    });

    it('when the storage refuses the extra access, the note plays the ordinary way and other notes do not try again', () => {
      const onRetry = vi.fn();
      const { unmount } = render(<VoiceNotePlayer {...props} onRetry={onRetry} />);
      fireEvent.error(audio()); // would not load that way
      expect(onRetry).not.toHaveBeenCalled(); // not treated as a broken link
      expect(audio()).not.toHaveAttribute('crossorigin');
      expect(levelBlocked()).toBe(false); // not sure yet: it might have been an expired link
      fireEvent.loadedMetadata(audio()); // the ordinary way worked: so the storage really refuses
      expect(levelBlocked()).toBe(true);
      unmount();
      render(<VoiceNotePlayer {...props} seedId="b2" />);
      expect(audio()).not.toHaveAttribute('crossorigin');
    });

    it('an expired link is still asked for again, and is not mistaken for the storage refusing', () => {
      const onRetry = vi.fn();
      render(<VoiceNotePlayer {...props} onRetry={onRetry} />);
      fireEvent.error(audio());
      fireEvent.error(audio());
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(levelBlocked()).toBe(false);
    });

    it('a copy kept on the phone (blob) needs no waiting and no storage permission', () => {
      render(<VoiceNotePlayer {...props} url="blob:https://app.example/1234" />);
      expect(audio()).not.toHaveAttribute('crossorigin');
      play();
      expect(FakeAudioContext.last!.sources).toHaveLength(1);
    });

    it('a measurement that fails leaves the note at its own level', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('offline');
      }));
      expect(await measureNote('zz', props.url)).toBe(0);
    });

    it('a failure to start the audio processing leaves the note playing the ordinary way', () => {
      vi.stubGlobal('AudioContext', class {
        constructor() {
          throw new Error('not allowed');
        }
      });
      render(<VoiceNotePlayer {...props} />);
      fireEvent.loadedMetadata(audio());
      play();
      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });
  });
});
