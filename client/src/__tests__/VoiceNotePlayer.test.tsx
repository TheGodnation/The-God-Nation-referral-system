import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
        waitForTap
        failed={false}
        onRequestDownload={onRequestDownload}
      />,
    );
    fireEvent.click(screen.getByText(/Voice message/));
    expect(onRequestDownload).toHaveBeenCalled();
  });

  it('shows a loading state, then a failed state', () => {
    const { rerender } = render(
      <VoiceNotePlayer url={null} byteSize={1000} seedId="a1" avatarName="Ben Tabe" waitForTap={false} failed={false} onRequestDownload={vi.fn()} />,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    rerender(<VoiceNotePlayer url={null} byteSize={1000} seedId="a1" avatarName="Ben Tabe" waitForTap={false} failed onRequestDownload={vi.fn()} />);
    expect(screen.getByText('⚠️')).toBeInTheDocument();
  });

  it('once a URL resolves, shows a play button and waveform with the sender avatar, and toggles play/pause', async () => {
    render(
      <VoiceNotePlayer
        url="https://files.example/voice.webm"
        byteSize={4000}
        seedId="a1"
        avatarName="Ben Tabe"
        avatarPhotoUrl={null}
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
});
