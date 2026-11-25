import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { VoiceNotePlayer } from '../components/chat/VoiceNotePlayer';
import { installOneSoundAtATime } from '../lib/oneAtATime';

// Starting a voice note pauses the one that was playing: two never speak at the same time.
const props = { byteSize: 400_000, durationMs: 60_000, avatarName: 'Ben Tabe', own: false, waitForTap: false, failed: false, onRequestDownload: vi.fn() };

function setPaused(el: HTMLMediaElement, paused: boolean) {
  Object.defineProperty(el, 'paused', { configurable: true, get: () => paused });
}

beforeAll(() => installOneSoundAtATime());

describe('one sound at a time', () => {
  it('starting a second voice note pauses the first', () => {
    render(
      <>
        <VoiceNotePlayer {...props} url="https://files.example/1.m4a" seedId="v1" />
        <VoiceNotePlayer {...props} url="https://files.example/2.m4a" seedId="v2" />
      </>,
    );
    const [first, second] = Array.from(document.querySelectorAll('audio'));
    const pauseFirst = vi.fn();
    const pauseSecond = vi.fn();
    first.pause = pauseFirst;
    second.pause = pauseSecond;
    setPaused(first, false); // the first is playing
    setPaused(second, false);
    fireEvent.play(second); // the second is started
    expect(pauseFirst).toHaveBeenCalledTimes(1);
    expect(pauseSecond).not.toHaveBeenCalled();
  });

  it('leaves paused ones alone, and a muted video does not pause anything', () => {
    const { container } = render(
      <>
        <audio src="a.m4a" />
        <video src="b.mp4" muted />
      </>,
    );
    const audio = container.querySelector('audio')!;
    const video = container.querySelector('video')!;
    const pauseAudio = vi.fn();
    audio.pause = pauseAudio;
    setPaused(audio, false);
    video.muted = true;
    fireEvent.play(video);
    expect(pauseAudio).not.toHaveBeenCalled();
  });
});
