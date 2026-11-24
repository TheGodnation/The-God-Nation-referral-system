import { describe, it, expect, vi, beforeAll } from 'vitest';
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
    expect(await screen.findByText('0:07')).toBeInTheDocument();
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
