import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MessageBubble } from '../components/chat/MessageBubble';
import { clearSharedPostCardCache, sharedPostLink } from '../components/chat/SharedPostChatCard';
import { clearLinkPreviewCache } from '../components/LinkPreviewCard';
import type { ChatMessage } from '../components/chat/types';

// A link to one of our own shared posts, sent in an assembly or group chat: a bold card with "Read more", which opens the whole
// post over the chat; "Back to the chat" (or the phone's back button) closes it. Private chats keep the ordinary link card.
const LINK = 'https://thegodnationacademy.org/news/post/p1';
const POST = {
  kind: 'post',
  id: 'p1',
  title: { en: 'Fasting week', fr: 'Semaine de jeûne' },
  body: { en: 'Beloved, from Monday we fast together.\n\nSecond paragraph of the whole post, only in the reader.', fr: 'Bien-aimés, dès lundi nous jeûnons.' },
  author: 'The God Nation',
  publishedAt: '2026-11-20T08:00:00.000Z',
  embed: null,
  photos: [{ url: '/api/shared/post/p1/photo/0' }],
  more: [],
};
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
const noop = () => {};
const handlers = { mediaBase: '/api/communities/c1/conversation', showSender: true, highlighted: false, onReply: noop, onMenu: noop, onReact: noop, onJumpTo: noop, onOpenPhoto: noop };
const msg = (body: string): ChatMessage => ({ id: 'm1', senderName: 'Grace', isOwn: false, body, createdAt: new Date().toISOString(), deleted: false, attachments: [] });

let shared: () => Promise<unknown>;
beforeEach(() => {
  clearSharedPostCardCache();
  clearLinkPreviewCache();
  shared = () => json(POST);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).startsWith('/api/shared/')) return shared();
    if (String(url).startsWith('/api/member/link-preview')) return json({ preview: { url: LINK, title: 'Plain card', description: '', image: null, site: 'thegodnationacademy.org' } });
    return json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('sharedPostLink', () => {
  it('knows our own shared post links, and nothing else', () => {
    expect(sharedPostLink(LINK)).toEqual({ kind: 'post', id: 'p1' });
    expect(sharedPostLink('https://www.thegodnationacademy.org/news/announcement/a-1')).toEqual({ kind: 'announcement', id: 'a-1' });
    expect(sharedPostLink('https://example.com/news/post/p1')).toBeNull();
    expect(sharedPostLink('https://thegodnationacademy.org/member/chats')).toBeNull();
  });
});

describe('A shared post link in an assembly or group chat', () => {
  it('shows a bold card: picture, The God Nation label, the title, the first lines and Read more', async () => {
    render(<MessageBubble m={msg(`Read this ${LINK}`)} {...handlers} />);
    const card = await screen.findByTestId('shared-post-card');
    expect(card).toHaveTextContent('The God Nation');
    expect(card).toHaveTextContent('Fasting week');
    expect(card).toHaveTextContent('Beloved, from Monday we fast together.');
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/shared/post/p1/photo/0');
    expect(screen.getByTestId('shared-post-read-more')).toHaveTextContent('Read more');
    expect(screen.queryByText('Plain card')).toBeNull();
  });

  it('opens the whole post over the chat with Read more, and Back to the chat closes it', async () => {
    render(<MessageBubble m={msg(LINK)} {...handlers} />);
    fireEvent.click(await screen.findByTestId('shared-post-read-more'));
    const reader = screen.getByTestId('shared-post-reader');
    expect(reader).toHaveTextContent('Second paragraph of the whole post, only in the reader.');
    fireEvent.click(screen.getByTestId('shared-post-back'));
    await waitFor(() => expect(screen.queryByTestId('shared-post-reader')).toBeNull());
    expect(screen.getByTestId('shared-post-card')).toBeInTheDocument(); // still in the chat, where they were
  });

  it('closes the post with the phone’s back button too', async () => {
    render(<MessageBubble m={msg(LINK)} {...handlers} />);
    fireEvent.click(await screen.findByTestId('shared-post-read-more'));
    expect(screen.getByTestId('shared-post-reader')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.queryByTestId('shared-post-reader')).toBeNull());
  });

  it('falls back to the ordinary link card when the post can no longer be shown', async () => {
    shared = () => json({ error: 'Not available.' }, 404);
    render(<MessageBubble m={msg(LINK)} {...handlers} />);
    expect(await screen.findByText('Plain card')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-post-card')).toBeNull();
  });

  it('is not used in a private chat (the ordinary link card stays)', async () => {
    render(<MessageBubble m={msg(LINK)} {...handlers} privateChat />);
    expect(await screen.findByText('Plain card')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-post-card')).toBeNull();
  });
});
