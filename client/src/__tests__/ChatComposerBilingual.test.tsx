import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

let uploads = 0;
vi.mock('../lib/chatMedia', async () => {
  const actual = await vi.importActual<typeof import('../lib/chatMedia')>('../lib/chatMedia');
  return {
    ...actual,
    uploadChatFile: vi.fn(async (_path: string, blob: Blob, filename: string) => {
      uploads += 1;
      return { storageKey: `communities/g1/attachments/k${uploads}`, originalFilename: filename, mimeType: 'audio/webm', byteSize: blob.size };
    }),
  };
});

import { ChatComposer } from '../components/chat/ChatComposer';

// Pause → listen → continue for every recording, and the central admin's
// voice message in English and French.
class Recorder {
  static isTypeSupported = vi.fn(() => true);
  static last: Recorder | null = null;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  constructor(_s: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    Recorder.last = this;
  }
  addEventListener(_type: string, fn: () => void) {
    this.listeners.push(fn);
  }
  requestData = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['more'], { type: this.mimeType }) });
    this.listeners.splice(0).forEach((fn) => fn());
  });
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

const played: { url: string; paused: boolean }[] = [];
class FakeAudio {
  onended: (() => void) | null = null;
  entry: { url: string; paused: boolean };
  constructor(url: string) {
    this.entry = { url, paused: false };
    played.push(this.entry);
  }
  play = vi.fn(async () => {});
  pause = vi.fn(() => {
    this.entry.paused = true;
  });
}

beforeEach(() => {
  uploads = 0;
  played.length = 0;
  vi.stubGlobal('MediaRecorder', Recorder as unknown as typeof MediaRecorder);
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) } });
  URL.createObjectURL = vi.fn(() => `blob:fake-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderComposer(props: Record<string, unknown> = {}) {
  const onSend = vi.fn().mockResolvedValue(true);
  render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} onPickMedia={vi.fn()} {...props} />);
  return onSend;
}

describe('Recording: pause, listen, carry on', () => {
  it('while paused you can listen to what was recorded so far, and resuming stops the playback', async () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to record a voice note' }));
    // Not offered while still recording.
    await screen.findByRole('button', { name: 'Pause' });
    expect(screen.queryByRole('button', { name: /Listen/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Listen/ }));
    });
    expect(Recorder.last?.requestData).toHaveBeenCalled();
    expect(played).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(played[0].paused).toBe(true);
    expect(Recorder.last?.resume).toHaveBeenCalled();
    // Still the same recording: nothing was cut or restarted.
    expect(Recorder.last?.start).toHaveBeenCalledTimes(1);
  });
});

describe('Voice message in two languages (central admin only)', () => {
  it('is not offered to anyone else', () => {
    renderComposer();
    expect(screen.queryByRole('button', { name: 'Voice message in two languages' })).not.toBeInTheDocument();
  });

  async function recordClip(language: 'English' | 'Français') {
    const row = screen.getByTestId(`dual-row-${language === 'English' ? 'en' : 'fr'}`);
    const start = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(start);
    await act(async () => {
      fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => /^(Record|Record again)$/.test(b.textContent ?? ''))!);
    });
    expect(await screen.findByText(new RegExp(`Recording the ${language} part`))).toBeInTheDocument();
    spy.mockReturnValue(start + 5000);
    fireEvent.click(screen.getByRole('button', { name: 'Send voice note' }));
    spy.mockRestore();
    await screen.findByTestId('dual-panel');
  }

  it('records English and French, marks it live, and sends both clips labelled in one message', async () => {
    const onSend = renderComposer({ bilingual: true });
    fireEvent.click(screen.getByRole('button', { name: 'Voice message in two languages' }));
    expect(screen.getByTestId('dual-panel')).toBeInTheDocument();
    // Nothing recorded yet: cannot send.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await recordClip('English');
    await recordClip('Français');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const sent = onSend.mock.calls[0][0];
    expect(sent.liveTeaching).toBe(true);
    expect(sent.attachments.map((a: any) => a.language)).toEqual(['en', 'fr']);
    expect(uploads).toBe(2);
  });

  it('one language only is allowed, and then it is an ordinary voice note', async () => {
    const onSend = renderComposer({ bilingual: true });
    fireEvent.click(screen.getByRole('button', { name: 'Voice message in two languages' }));
    await recordClip('Français');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const sent = onSend.mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].language).toBeUndefined();
    expect(sent.liveTeaching).toBeUndefined();
  });

  it('tells the others "recording" while it records, and says live when marked', async () => {
    const onRecording = vi.fn();
    renderComposer({ bilingual: true, onRecording });
    fireEvent.click(screen.getByRole('button', { name: 'Voice message in two languages' }));
    fireEvent.click(screen.getByRole('checkbox'));
    await recordClip('English');
    expect(onRecording).toHaveBeenCalledWith(true, true);
    expect(onRecording).toHaveBeenLastCalledWith(false, true);
  });
});
