import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadingBubble } from '../components/chat/UploadingBubble';
import type { MediaSendJob } from '../lib/useMediaUploads';

// A voice note shows in the chat the moment it is sent (a turning ring, like WhatsApp), before the upload is done.
const voiceJob = (patch: Partial<MediaSendJob> = {}): MediaSendJob => ({
  id: 'u1',
  items: [{ name: 'voice-note-1.webm', kind: 'voice', previewUrl: null, byteSize: 48_000, durationMs: 7_000 }],
  progress: 0.4,
  status: 'uploading',
  ...patch,
});

describe('A voice note that is still going up', () => {
  it('shows at once looking like the finished voice note (its length and bars), with its progress, and can be stopped', () => {
    const onCancel = vi.fn();
    render(<UploadingBubble job={voiceJob()} onCancel={onCancel} onRetry={vi.fn()} />);
    expect(screen.getByTestId('uploading-voice')).toHaveTextContent('0:07');
    expect(screen.getByTestId('uploading-voice').querySelectorAll('span[style]').length).toBeGreaterThan(20);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    fireEvent.click(screen.getByRole('button', { name: /stop|cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('keeps turning while it is being posted, and offers “Try again” if it failed', () => {
    const { rerender } = render(<UploadingBubble job={voiceJob({ status: 'sending', progress: 1 })} onCancel={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByTestId('uploading-bubble')).toHaveTextContent('Sending');
    const onRetry = vi.fn();
    rerender(<UploadingBubble job={voiceJob({ status: 'failed', problem: 'failed' })} onCancel={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
