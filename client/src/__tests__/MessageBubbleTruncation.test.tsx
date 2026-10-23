import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { ChatMessage } from '../components/chat/types';

// WhatsApp-style long-message truncation (both group and private chats use
// this same MessageBubble component — see its own privateChat prop).

function baseMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    senderName: 'Grace',
    isOwn: false,
    body: null,
    createdAt: new Date().toISOString(),
    deleted: false,
    attachments: [],
    ...overrides,
  };
}

const noop = () => {};
const bubbleHandlers = {
  mediaBase: '/api/communities/c1/conversation',
  showSender: true,
  highlighted: false,
  onReply: noop,
  onMenu: noop,
  onReact: noop,
  onJumpTo: noop,
  onOpenPhoto: noop,
};

describe('MessageBubble — long message truncation', () => {
  it('renders a short message normally, with no "Read more" control', () => {
    render(<MessageBubble m={baseMessage({ body: 'See you at the meeting tomorrow!' })} {...bubbleHandlers} />);
    expect(screen.getByText('See you at the meeting tomorrow!')).toBeInTheDocument();
    expect(screen.queryByText('Read more')).not.toBeInTheDocument();
  });

  it('clamps a long message and offers "Read more", which reveals the full text and preserves it exactly (formatting, emoji, links)', () => {
    const longBody = `Here is the full plan for Sunday 🙏\nhttps://example.com/plan\n${'Word '.repeat(80)}`;
    render(<MessageBubble m={baseMessage({ body: longBody })} {...bubbleHandlers} />);

    const paragraph = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === longBody);
    expect(paragraph.className).toContain('line-clamp-6');

    const readMore = screen.getByRole('button', { name: 'Read more' });
    fireEvent.click(readMore);

    expect(paragraph.className).not.toContain('line-clamp-6');
    expect(paragraph.textContent).toBe(longBody);
    expect(screen.getByRole('button', { name: 'Read less' })).toBeInTheDocument();
  });

  it('"Read less" collapses it again', () => {
    const longBody = 'x'.repeat(400);
    render(<MessageBubble m={baseMessage({ body: longBody })} {...bubbleHandlers} />);

    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read less' }));

    const paragraph = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === longBody);
    expect(paragraph.className).toContain('line-clamp-6');
  });

  it('a message with many short lines (over 7) is also treated as long, even under the character threshold', () => {
    const manyLines = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
    render(<MessageBubble m={baseMessage({ body: manyLines })} {...bubbleHandlers} />);
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument();
  });

  it('works the same way in a private chat bubble (privateChat=true)', () => {
    const longBody = 'y'.repeat(400);
    render(<MessageBubble m={baseMessage({ body: longBody, isOwn: true })} {...bubbleHandlers} privateChat />);
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument();
  });

  it('clicking "Read more" does not trigger the bubble\'s own reply/long-press handlers', () => {
    const onMenu = vi.fn();
    const longBody = 'z'.repeat(400);
    render(<MessageBubble m={baseMessage({ body: longBody })} {...bubbleHandlers} onMenu={onMenu} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(onMenu).not.toHaveBeenCalled();
  });
});
