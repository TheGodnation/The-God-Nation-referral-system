import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { ChatMessage } from '../components/chat/types';

// Dragging the waveform of a voice note must not also be read by the message as "swipe to reply" (which slides the whole message)
// or "press and hold" (which opens its menu). Swiping the message itself still replies.
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};
const message: ChatMessage = {
  id: 'm1',
  senderName: 'Evangelist Stanley',
  isOwn: false,
  body: null,
  createdAt: new Date().toISOString(),
  deleted: false,
  attachments: [{ id: 'a1', originalFilename: 'v.m4a', mimeType: 'audio/mp4', byteSize: 30_000, durationMs: 90_000 }],
};

async function renderVoice(over: { onReply?: () => void; onMenu?: () => void } = {}) {
  vi.stubGlobal('fetch', vi.fn(() => json({ url: 'https://files.example/v.m4a', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })));
  const onReply = over.onReply ?? vi.fn();
  const onMenu = over.onMenu ?? vi.fn();
  const view = render(<MessageBubble m={message} mediaBase="/api/communities/c1/conversation" showSender highlighted={false} onReply={onReply} onMenu={onMenu} onReact={noop} onJumpTo={noop} onOpenPhoto={noop} />);
  const slider = await screen.findByRole('slider'); // the audio is ready
  const moved = () => view.container.querySelector<HTMLElement>('.transition-transform')!;
  return { slider, moved, onReply, onMenu };
}
const touches = (x: number) => ({ touches: [{ clientX: x, clientY: 100 }] });

describe('A voice note inside a message', () => {
  it('swiping the message to the right still slides it and replies', async () => {
    const { moved, onReply } = await renderVoice();
    const bubble = moved().firstElementChild as HTMLElement; // the bubble itself, not the waveform
    fireEvent.touchStart(bubble, touches(10));
    fireEvent.touchMove(bubble, touches(70));
    expect(moved().style.transform).toBe('translateX(60px)');
    fireEvent.touchEnd(bubble);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('dragging the waveform to the right does not slide the message or reply to it', async () => {
    const { slider, moved, onReply } = await renderVoice();
    fireEvent.touchStart(slider, touches(10));
    fireEvent.touchMove(slider, touches(40));
    fireEvent.touchMove(slider, touches(90));
    expect(moved().style.transform).toBe('');
    fireEvent.touchEnd(slider);
    expect(onReply).not.toHaveBeenCalled();
    expect(moved().style.transform).toBe('');
  });

  it('holding a finger on the waveform does not open the message menu', async () => {
    const { slider, onMenu } = await renderVoice();
    fireEvent.touchStart(slider, touches(10));
    await new Promise((r) => setTimeout(r, 600)); // longer than the press-and-hold time
    fireEvent.touchEnd(slider);
    expect(onMenu).not.toHaveBeenCalled();
    // The phone's own "context menu" on a long press on the waveform is stopped too.
    expect(fireEvent.contextMenu(slider)).toBe(false);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('pressing and holding the message itself still opens its menu', async () => {
    const { moved, onMenu } = await renderVoice();
    const bubble = moved().firstElementChild as HTMLElement;
    fireEvent.touchStart(bubble, touches(10));
    await new Promise((r) => setTimeout(r, 600));
    fireEvent.touchEnd(bubble);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
