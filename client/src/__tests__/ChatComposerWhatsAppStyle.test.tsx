import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChatComposer } from '../components/chat/ChatComposer';

// The chat bar laid out like WhatsApp: smiley → emoji panel in the
// keyboard's place, camera inside the bar, and a recording screen with
// Delete, Pause/Resume and Send.
class PausableRecorder {
  static isTypeSupported = vi.fn(() => true);
  static last: PausableRecorder | null = null;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    PausableRecorder.last = this;
  }
  start = vi.fn(() => {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['x'], { type: this.mimeType }) });
  });
  pause = vi.fn(() => {
    this.state = 'paused';
  });
  resume = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.onstop?.();
  });
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', PausableRecorder as unknown as typeof MediaRecorder);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

function renderComposer(onSend = vi.fn().mockResolvedValue(true)) {
  render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} onPickMedia={vi.fn()} />);
  return onSend;
}

describe('Chat bar — WhatsApp layout', () => {
  it('has the smiley, paperclip and camera in the bar, and hides the camera once something is typed', () => {
    renderComposer();
    expect(screen.getByRole('button', { name: 'Emojis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach a photo, video or document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Amen' } });
    expect(screen.queryByRole('button', { name: 'Take a photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('the smiley opens the emoji panel; picked emojis go into the message, and the delete key removes one whole emoji', async () => {
    const onSend = renderComposer();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Praise God ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    expect(await screen.findByTestId('emoji-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show keyboard' })).toBeInTheDocument();

    // Recents start with a few everyday ones.
    fireEvent.click(screen.getAllByRole('button', { name: '🙏' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '❤️' })[0]);
    expect(screen.getByLabelText('Message')).toHaveValue('Praise God 🙏❤️');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByLabelText('Message')).toHaveValue('Praise God 🙏');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: 'Praise God 🙏' }));
  });

  it('searches emojis by name, and remembers recently used ones', async () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    await screen.findByTestId('emoji-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Search emoji' }));
    fireEvent.change(screen.getByLabelText('Search emoji'), { target: { value: 'cameroon' } });
    fireEvent.click(screen.getByRole('button', { name: '🇨🇲' }));
    expect(screen.getByLabelText('Message')).toHaveValue('🇨🇲');
    expect(JSON.parse(window.localStorage.getItem('godnation.emojiRecents') ?? '[]')[0]).toBe('🇨🇲');
  });

  it('tapping the keyboard button closes the panel', async () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Emojis' }));
    await screen.findByTestId('emoji-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Show keyboard' }));
    expect(screen.queryByTestId('emoji-panel')).not.toBeInTheDocument();
  });
});

describe('Recording screen', () => {
  it('pauses and resumes the recording, then sends it', async () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to record a voice note' }));
    const pause = await screen.findByRole('button', { name: 'Pause' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(pause);
    expect(PausableRecorder.last?.pause).toHaveBeenCalled();
    expect(screen.getByText('Paused — tap Resume to continue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(PausableRecorder.last?.resume).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send voice note' }));
    expect(PausableRecorder.last?.stop).toHaveBeenCalled();
  });
});
