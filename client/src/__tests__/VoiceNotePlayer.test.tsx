import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceNotePlayer } from '../components/chat/VoiceNotePlayer';

// jsdom has no real media playback — mock the two methods the player calls.
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

describe('VoiceNotePlayer', () => {
  it('shows the sender avatar and a download pill while gated by Data Saver', () => {
    render(
      <VoiceNotePlayer
        url={null}
        byteSize={29000}
        seedId="a1"
        avatarName="Ben Tabe"
        avatarPhotoUrl={null}
        own={false}
        waitForTap
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    expect(screen.getByText(/Voice message/)).toBeInTheDocument();
    expect(screen.getByText(/28 KB/)).toBeInTheDocument();
  });

  it('tapping the download pill requests the download', () => {
    const onRequestDownload = vi.fn();
    render(
      <VoiceNotePlayer
        url={null}
        byteSize={29000}
        seedId="a1"
        avatarName="Ben Tabe"
        avatarPhotoUrl={null}
        own={false}
        waitForTap
        failed={false}
        onRequestDownload={onRequestDownload}
      />,
    );
    fireEvent.click(screen.getByText(/Voice message/));
    expect(onRequestDownload).toHaveBeenCalled();
  });

  it('looks finished before the audio is ready: the photo, the length saved with the message and the bars, with a ring on the play button', () => {
    render(
      <VoiceNotePlayer url={null} byteSize={30000} durationMs={7000} seedId="a1" avatarName="Ben Tabe" own={false} waitForTap={false} failed={false} onRequestDownload={vi.fn()} />,
    );
    expect(screen.getByText('BT')).toBeInTheDocument();
    expect(screen.getByText('0:07')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull(); // no "Loading…" wording in the bubble itself
    const waiting = screen.getByRole('button', { name: 'Loading…' });
    expect(waiting.querySelector('.animate-spin')).not.toBeNull();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('shows a dash for the length of an older note until its audio says how long it is', () => {
    render(<VoiceNotePlayer url={null} byteSize={1000} seedId="a1" avatarName="Ben Tabe" own={false} waitForTap={false} failed={false} onRequestDownload={vi.fn()} />);
    expect(screen.getByText('–:––')).toBeInTheDocument();
  });

  it('plays by itself when pressed before the audio was ready, as soon as it is', async () => {
    const props = { byteSize: 4000, seedId: 'a1', avatarName: 'Ben Tabe', own: false, waitForTap: false, failed: false, onRequestDownload: vi.fn() };
    const { rerender } = render(<VoiceNotePlayer url={null} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loading…' }));
    const play = window.HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    play.mockClear();
    rerender(<VoiceNotePlayer url="https://files.example/voice.webm" {...props} />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });

  it('a note that could not be loaded offers a “try again” button', () => {
    const onRetry = vi.fn();
    render(<VoiceNotePlayer url={null} byteSize={1000} seedId="a1" avatarName="Ben Tabe" own={false} waitForTap={false} failed onRequestDownload={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Could not load. Tap to try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('quietly asks for a fresh link twice when the audio will not load, then offers “try again”', () => {
    const onRetry = vi.fn();
    render(<VoiceNotePlayer url="https://files.example/voice.webm" byteSize={4000} seedId="a1" avatarName="Ben Tabe" own={false} waitForTap={false} failed={false} onRequestDownload={vi.fn()} onRetry={onRetry} />);
    const audio = document.querySelector('audio')!;
    fireEvent.error(audio);
    fireEvent.error(audio);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Could not load. Tap to try again' })).toBeNull();
    fireEvent.error(audio);
    expect(screen.getByRole('button', { name: 'Could not load. Tap to try again' })).toBeInTheDocument();
  });

  it('keeps the saved length when the audio cannot tell how long it is, and tells the phone once the whole note is down', () => {
    const onBuffered = vi.fn();
    render(<VoiceNotePlayer url="https://files.example/voice.webm" byteSize={4000} durationMs={12000} seedId="a1" avatarName="Ben Tabe" own={false} waitForTap={false} failed={false} onRequestDownload={vi.fn()} onBuffered={onBuffered} />);
    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText('0:12')).toBeInTheDocument();
    expect(audio).toHaveAttribute('preload', 'auto'); // a small note is fetched completely, so play starts at once
    fireEvent.canPlayThrough(audio);
    expect(onBuffered).toHaveBeenCalled();
  });

  it('once a URL resolves, shows a play button and waveform with the sender avatar, and toggles play/pause', async () => {
    render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Ben Tabe"
        avatarPhotoUrl={null}
        own={false}
        waitForTap={false}
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    expect(screen.getByText('BT')).toBeInTheDocument(); // Avatar initials fallback
    const playButton = screen.getByRole('button', { name: 'Play voice message' });
    expect(document.querySelector('audio')).toHaveAttribute('src', 'https://files.example/voice.webm');

    fireEvent.click(playButton);
    fireEvent.play(document.querySelector('audio')!);
    expect(await screen.findByRole('button', { name: 'Pause voice message' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause voice message' }));
    fireEvent.pause(document.querySelector('audio')!);
    expect(await screen.findByRole('button', { name: 'Play voice message' })).toBeInTheDocument();
  });

  it('shows elapsed duration as the audio plays', async () => {
    render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Ben Tabe"
        own={false}
        waitForTap={false}
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: 12, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(await screen.findByText('0:12')).toBeInTheDocument();

    Object.defineProperty(audio, 'currentTime', { value: 5, configurable: true });
    fireEvent.timeUpdate(audio);
    // Once it is playing (or part-way through) the time reads "where you are / how long it is".
    expect(await screen.findByText('0:05 / 0:12')).toBeInTheDocument();
  });

  it('resets to the start when playback ends', async () => {
    render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Ben Tabe"
        own={false}
        waitForTap={false}
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: 10, configurable: true });
    fireEvent.loadedMetadata(audio);
    fireEvent.play(audio);
    await screen.findByRole('button', { name: 'Pause voice message' });

    fireEvent.ended(audio);
    expect(await screen.findByRole('button', { name: 'Play voice message' })).toBeInTheDocument();
    expect(screen.getByText('0:10')).toBeInTheDocument();
  });

  it('puts the avatar on the left for a sent (own) voice note', () => {
    const { container } = render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Me"
        own
        waitForTap={false}
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    expect(container.firstElementChild).toHaveClass('flex-row');
    expect(container.firstElementChild).not.toHaveClass('flex-row-reverse');
  });

  it('puts the avatar on the right for a received voice note', () => {
    const { container } = render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Ben Tabe"
        own={false}
        waitForTap={false}
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    expect(container.firstElementChild).toHaveClass('flex-row-reverse');
  });

  it('keeps the play button immediately left of the waveform for a received note too — only the avatar swaps sides', () => {
    render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Ben Tabe"
        own={false}
        waitForTap={false}
        failed={false}
        onRequestDownload={vi.fn()}
      />,
    );
    const playButton = screen.getByRole('button', { name: 'Play voice message' });
    const waveform = screen.getByRole('slider');
    // The button must come before the waveform in the content group's own
    // (never-reversed) DOM order, same as for a sent note — only the
    // avatar's side flips for a received note.
    // eslint-disable-next-line no-bitwise
    expect(playButton.compareDocumentPosition(waveform) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Moving about inside a voice note: drag the waveform, back / forward 10 seconds, the arrow keys, and the playback speed.
describe('VoiceNotePlayer — moving about inside the note', () => {
  const props = { url: 'https://files.example/voice.webm', byteSize: 400_000, seedId: 'a1', avatarName: 'Ben Tabe', own: false, waitForTap: false, failed: false, onRequestDownload: vi.fn() };
  beforeEach(() => window.localStorage.clear());
  // The test environment has no PointerEvent (a real phone does), so a finger's position would be lost: stand in for it.
  beforeAll(() => {
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventStandIn extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 1;
        }
      }
      (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStandIn;
    }
  });

  // An audio element whose position and speed can be read back (jsdom does not play anything).
  function setUpAudio(duration: number, at = 0) {
    const audio = document.querySelector('audio')!;
    let time = at;
    let speed = 1;
    Object.defineProperty(audio, 'duration', { value: duration, configurable: true });
    Object.defineProperty(audio, 'currentTime', { get: () => time, set: (v: number) => (time = v), configurable: true });
    Object.defineProperty(audio, 'playbackRate', { get: () => speed, set: (v: number) => (speed = v), configurable: true });
    fireEvent.loadedMetadata(audio);
    return { audio, now: () => time, speed: () => speed };
  }
  // The waveform is 200px wide, starting at the left edge, so a finger at x seconds-fraction x/200.
  function sliderOf() {
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 36, width: 200, height: 36, x: 0, y: 0, toJSON: () => ({}) });
    return slider;
  }

  it('shows the position under the finger, large, while you drag the waveform, and jumps there when you let go', async () => {
    render(<VoiceNotePlayer {...props} />);
    const a = setUpAudio(120);
    const slider = sliderOf();
    expect(screen.getByTestId('voice-time')).toHaveTextContent('2:00');
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    expect(await screen.findByText('1:00 / 2:00')).toBeInTheDocument();
    expect(screen.getByTestId('voice-time')).toHaveClass('font-bold'); // large and clear while dragging
    expect(a.now()).toBe(0); // nothing jumps while the finger is still moving
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });
    expect(await screen.findByText('1:30 / 2:00')).toBeInTheDocument();
    expect(screen.getByTestId('voice-thumb')).toHaveStyle({ left: '75%' });
    fireEvent.pointerUp(slider, { clientX: 150, pointerId: 1 });
    expect(a.now()).toBe(90);
    expect(screen.getByTestId('voice-time')).not.toHaveClass('font-bold');
    expect(screen.getByTestId('voice-time')).toHaveTextContent('1:30 / 2:00');
  });

  it('a drag that is cancelled (or runs past either end) changes nothing, or stops at the end', async () => {
    render(<VoiceNotePlayer {...props} />);
    const a = setUpAudio(120, 20);
    fireEvent.timeUpdate(document.querySelector('audio')!);
    const slider = sliderOf();
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    fireEvent.pointerCancel(slider, { pointerId: 1 });
    expect(a.now()).toBe(20);
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 999, pointerId: 1 }); // far past the right end
    expect(a.now()).toBe(120);
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: -50, pointerId: 1 }); // before the start
    expect(a.now()).toBe(0);
  });

  it('has back and forward 10 seconds buttons that stop at the start and the end', async () => {
    render(<VoiceNotePlayer {...props} />);
    const a = setUpAudio(120, 30);
    fireEvent.click(screen.getByTestId('voice-forward'));
    expect(a.now()).toBe(40);
    fireEvent.click(screen.getByTestId('voice-back'));
    fireEvent.click(screen.getByTestId('voice-back'));
    fireEvent.click(screen.getByTestId('voice-back'));
    fireEvent.click(screen.getByTestId('voice-back'));
    expect(a.now()).toBe(0); // never before the start
    fireEvent.timeUpdate(document.querySelector('audio')!);
    for (let i = 0; i < 13; i++) fireEvent.click(screen.getByTestId('voice-forward'));
    expect(a.now()).toBe(120); // never past the end
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeInTheDocument();
  });

  it('the arrow keys move 5 seconds', () => {
    render(<VoiceNotePlayer {...props} />);
    const a = setUpAudio(120, 30);
    fireEvent.timeUpdate(document.querySelector('audio')!);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(a.now()).toBe(35);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(a.now()).toBe(25);
    expect(slider).toHaveAttribute('aria-valuetext', '0:25 / 2:00');
  });

  it('the speed button goes 1× → 1.5× → 2× → 1×, changes the audio, and is never remembered: every note starts at 1×', () => {
    const { unmount } = render(<VoiceNotePlayer {...props} />);
    const a = setUpAudio(120);
    const speed = screen.getByTestId('voice-speed');
    expect(speed).toHaveTextContent('1×');
    fireEvent.click(speed);
    expect(speed).toHaveTextContent('1.5×');
    expect(a.speed()).toBe(1.5);
    expect(window.localStorage.getItem('voice:rate')).toBeNull(); // not kept
    fireEvent.click(speed);
    expect(speed).toHaveTextContent('2×');
    fireEvent.click(speed);
    expect(speed).toHaveTextContent('1×');
    fireEvent.click(speed);
    unmount();
    // Another voice note starts at normal speed, even if an old copy of the app left a faster speed saved on the phone.
    window.localStorage.setItem('voice:rate', '2');
    render(<VoiceNotePlayer {...props} seedId="b2" />);
    expect(screen.getByTestId('voice-speed')).toHaveTextContent('1×');
  });

  it('offers none of this until the audio is ready', () => {
    render(<VoiceNotePlayer {...props} url={null} durationMs={30_000} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByTestId('voice-forward')).toBeNull();
    expect(screen.queryByTestId('voice-speed')).toBeNull();
  });
});
