import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatComposer } from '../components/chat/ChatComposer';

// Tap-to-record voice notes: no more press-and-hold. Mocks the browser
// recording primitives (MediaRecorder, getUserMedia) this component drives.
class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
  }
  start = vi.fn((_timeslice?: number) => {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['x'], { type: this.mimeType }) });
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.onstop?.();
  });
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder as unknown as typeof MediaRecorder);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.includes('/api/communities/g1/conversation/attachments')) {
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ storageKey: 'k1', uploadUrl: 'https://mock-r2.example/upload' }) });
      }
      if (method === 'PUT' && url.includes('mock-r2.example')) {
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatComposer — voice notes', () => {
  it('tapping the mic starts recording immediately (no holding) and shows Cancel + Send', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tap to record a voice note' }));

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send voice note' })).toBeInTheDocument();
  });

  it('tapping Send stops recording and sends the voice note as an attachment', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tap to record a voice note' }));
    await screen.findByRole('button', { name: 'Send voice note' });
    // The route rejects a recording shorter than ~0.7s ("hold a little
    // longer") — give it enough real elapsed time to count as a real one.
    await new Promise((r) => setTimeout(r, 750));
    fireEvent.click(screen.getByRole('button', { name: 'Send voice note' }));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].attachments).toHaveLength(1);
    // Back to the normal typing bar once sent.
    expect(await screen.findByRole('button', { name: 'Tap to record a voice note' })).toBeInTheDocument();
  });

  it('tapping Cancel discards the recording without sending', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tap to record a voice note' }));
    await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('button', { name: 'Tap to record a voice note' })).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('allows a message up to WhatsApp\'s own character limit, not a shorter cap', () => {
    render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByLabelText('Message')).toHaveAttribute('maxlength', '65536');
  });
});
