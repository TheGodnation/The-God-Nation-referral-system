import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceNotePlayer } from '../components/chat/VoiceNotePlayer';
import { boostBlocked, resetBoostForTests } from '../lib/voiceBoost';

// The loudness boost on voice notes: an amplifier + compressor + limiter in front of the speaker. It must never leave a note silent:
// only hooked up from a tap, only when the storage is known to allow it, and with a way back to the ordinary playing.
class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = {};
  sources: unknown[] = [];
  gains: { gain: { value: number } }[] = [];
  compressors: { threshold: { value: number }; ratio: { value: number } }[] = [];
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
    const node = { gain: { value: 1 }, connect: vi.fn() };
    this.gains.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const node = { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn() };
    this.compressors.push(node);
    return node;
  }
}

const props = { url: 'https://files.example/voice.m4a', byteSize: 400_000, durationMs: 60_000, seedId: 'a1', avatarName: 'Ben Tabe', own: false, waitForTap: false, failed: false, onRequestDownload: vi.fn() };

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});
beforeEach(() => {
  window.localStorage.clear();
  resetBoostForTests();
  FakeAudioContext.last = null;
});
afterEach(() => vi.unstubAllGlobals());

const audio = () => document.querySelector('audio')!;
const play = () => fireEvent.click(screen.getByRole('button', { name: /Play voice message|Pause voice message/ }));

describe('Loudness boost on a voice note', () => {
  it('is not offered on a phone that cannot do it, and the audio is fetched the ordinary way', () => {
    render(<VoiceNotePlayer {...props} />);
    expect(screen.queryByTestId('voice-boost')).toBeNull();
    expect(audio()).not.toHaveAttribute('crossorigin');
  });

  describe('on a phone that can', () => {
    beforeEach(() => vi.stubGlobal('AudioContext', FakeAudioContext));

    it('is on at "Loud" from the start, and hooks the note up to the amplifier once, from the tap that plays it', () => {
      render(<VoiceNotePlayer {...props} />);
      expect(audio()).toHaveAttribute('crossorigin', 'anonymous');
      expect(screen.getByTestId('voice-boost')).toHaveTextContent('🔊');
      expect(screen.getByRole('button', { name: 'Volume boost: Loud. Tap to change' })).toBeInTheDocument();
      fireEvent.loadedMetadata(audio()); // it loaded the way the boost needs
      expect(FakeAudioContext.last).toBeNull(); // nothing is started before a tap
      play();
      const ctx = FakeAudioContext.last!;
      expect(ctx.resume).toHaveBeenCalled();
      expect(ctx.sources).toHaveLength(1);
      // Loud: about twice as loud, with the compressor evening it out.
      expect(ctx.gains[0].gain.value).toBe(2);
      expect(ctx.compressors[0]).toMatchObject({ threshold: { value: -24 }, ratio: { value: 8 } });
      fireEvent.play(audio());
      play(); // pause and play again: no second hook-up
      play();
      expect(ctx.sources).toHaveLength(1);
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

    it('the 🔊 button goes Loud → Maximum → Off → Loud, changes the level at once and remembers it', () => {
      render(<VoiceNotePlayer {...props} />);
      fireEvent.loadedMetadata(audio());
      play();
      const ctx = FakeAudioContext.last!;
      const button = screen.getByTestId('voice-boost');
      fireEvent.click(button);
      expect(button).toHaveTextContent('🔊+');
      expect(ctx.gains[0].gain.value).toBe(3.5);
      expect(ctx.gains[1].gain.value).toBe(1.15);
      expect(ctx.compressors[0].threshold.value).toBe(-30);
      expect(window.localStorage.getItem('voice:boost')).toBe('max');
      fireEvent.click(button);
      expect(button).toHaveTextContent('🔈');
      expect(ctx.gains[0].gain.value).toBe(1); // untouched sound
      expect(ctx.compressors[0].ratio.value).toBe(1);
      expect(window.localStorage.getItem('voice:boost')).toBe('off');
      fireEvent.click(button);
      expect(button).toHaveTextContent('🔊');
      expect(ctx.gains[0].gain.value).toBe(2);
      expect(ctx.sources).toHaveLength(1); // still one hook-up
    });

    it('with the boost off, playing leaves the sound untouched; switching it on later hooks it up at that tap', () => {
      window.localStorage.setItem('voice:boost', 'off');
      render(<VoiceNotePlayer {...props} />);
      fireEvent.loadedMetadata(audio());
      play();
      expect(FakeAudioContext.last?.sources ?? []).toHaveLength(0);
      fireEvent.click(screen.getByTestId('voice-boost'));
      expect(FakeAudioContext.last!.sources).toHaveLength(1);
      expect(FakeAudioContext.last!.gains[0].gain.value).toBe(2);
    });

    it('when the storage refuses the extra access, the note plays the ordinary way, no boost is offered, and other notes do not try again', () => {
      const onRetry = vi.fn();
      const { unmount } = render(<VoiceNotePlayer {...props} onRetry={onRetry} />);
      expect(audio()).toHaveAttribute('crossorigin', 'anonymous');
      fireEvent.error(audio()); // would not load that way
      expect(onRetry).not.toHaveBeenCalled(); // not treated as a broken link
      expect(audio()).not.toHaveAttribute('crossorigin'); // the ordinary way
      expect(screen.queryByTestId('voice-boost')).toBeNull();
      expect(boostBlocked()).toBe(false); // not sure yet: it might have been an expired link
      fireEvent.loadedMetadata(audio()); // the ordinary way worked: so the storage really refuses
      expect(boostBlocked()).toBe(true);
      expect(screen.getByRole('button', { name: 'Play voice message' })).toBeInTheDocument();
      unmount();
      render(<VoiceNotePlayer {...props} seedId="b2" />);
      expect(audio()).not.toHaveAttribute('crossorigin');
      expect(screen.queryByTestId('voice-boost')).toBeNull();
    });

    it('an expired link is still asked for again, and is not mistaken for the storage refusing the boost', () => {
      const onRetry = vi.fn();
      render(<VoiceNotePlayer {...props} onRetry={onRetry} />);
      fireEvent.error(audio()); // first failure: the ordinary way is tried
      fireEvent.error(audio()); // that fails too: now it is a link problem
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(boostBlocked()).toBe(false); // the boost stays available for other notes
    });

    it('a copy kept on the phone (blob) needs no waiting and no storage permission', () => {
      render(<VoiceNotePlayer {...props} url="blob:https://app.example/1234" />);
      expect(audio()).not.toHaveAttribute('crossorigin');
      expect(screen.getByTestId('voice-boost')).toBeInTheDocument();
      play(); // no metadata needed first
      expect(FakeAudioContext.last!.sources).toHaveLength(1);
    });

    it('a failure to start the amplifier leaves the note playing the ordinary way', () => {
      vi.stubGlobal('AudioContext', class {
        constructor() {
          throw new Error('not allowed');
        }
      });
      render(<VoiceNotePlayer {...props} />);
      fireEvent.loadedMetadata(audio());
      play();
      expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled(); // it still plays
    });
  });
});
