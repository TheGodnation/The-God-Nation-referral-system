import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PinnedMessages, type ChatPin } from '../components/chat/PinnedMessages';
import { MessageBubble } from '../components/chat/MessageBubble';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import type { ChatMessage } from '../components/chat/types';

// Pinned messages at the top of an assembly's chat, the gold "Important"
// chip for one that has not been seen, the special look of the central
// admin's messages, and pinning from the message menu.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const pin = (over: Partial<ChatPin> = {}): ChatPin => ({
  messageId: 'm1',
  senderName: 'Stanley Ndoh',
  senderBadge: 'National Coordinator',
  body: 'Everyone: the conference is on Saturday at 9am. Please arrive early.',
  createdAt: '2026-11-01T10:00:00Z',
  pinnedAt: '2026-11-01T10:05:00Z',
  unseen: false,
  ...over,
});

describe('PinnedMessages', () => {
  it('shows nothing when nothing is pinned', () => {
    const { container } = render(<PinnedMessages pins={[]} canPin={false} onSeen={() => {}} onShowInChat={() => {}} onUnpin={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pinned message at the top, and opens it in full', () => {
    render(<PinnedMessages pins={[pin()]} canPin={false} onSeen={() => {}} onShowInChat={() => {}} onUnpin={() => {}} />);
    const bar = screen.getByTestId('pinned-messages');
    expect(bar).toHaveTextContent('Pinned message');
    expect(bar).toHaveTextContent('Stanley Ndoh');
    expect(bar).toHaveTextContent('the conference is on Saturday at 9am');
    expect(screen.queryByTestId('important-chip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpin' })).not.toBeInTheDocument();
  });

  it('turns gold with "Important message, tap to read" when unseen; tapping opens it and counts it as seen', () => {
    const onSeen = vi.fn();
    render(<PinnedMessages pins={[pin({ unseen: true })]} canPin={false} onSeen={onSeen} onShowInChat={() => {}} onUnpin={() => {}} />);
    const chip = screen.getByTestId('important-chip');
    expect(chip).toHaveTextContent('Important message, tap to read');
    expect(screen.getByTestId('pinned-messages').className).toContain('bg-amber-100');
    fireEvent.click(chip);
    expect(onSeen).toHaveBeenCalledWith('m1');
    expect(screen.getByText(/the conference is on Saturday at 9am/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in chat' })).toBeInTheDocument();
  });

  it('goes to the pin nobody has read when there are several, and steps through them', () => {
    const onSeen = vi.fn();
    const pins = [pin({ messageId: 'a', body: 'First pinned' }), pin({ messageId: 'b', body: 'Second pinned', unseen: true }), pin({ messageId: 'c', body: 'Third pinned' })];
    render(<PinnedMessages pins={pins} canPin={false} onSeen={onSeen} onShowInChat={() => {}} onUnpin={() => {}} />);
    fireEvent.click(screen.getByTestId('important-chip'));
    expect(onSeen).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('pinned-messages')).toHaveTextContent('Pinned 2 of 3');
    expect(screen.getByText('Second pinned')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Third pinned')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('First pinned')).toBeInTheDocument();
  });

  it('shows the translation when there is one, and a picture or teaching as words', () => {
    const { rerender } = render(
      <PinnedMessages pins={[pin({ body: 'Bonjour à tous', translation: { sourceLanguage: 'fr', translatedBody: 'Hello everyone' } })]} canPin={false} onSeen={() => {}} onShowInChat={() => {}} onUnpin={() => {}} />,
    );
    expect(screen.getByText('Hello everyone')).toBeInTheDocument();
    rerender(<PinnedMessages pins={[pin({ body: null, teachingTitle: 'Walking in Dominion' })]} canPin={false} onSeen={() => {}} onShowInChat={() => {}} onUnpin={() => {}} />);
    expect(screen.getByText('📚 Walking in Dominion')).toBeInTheDocument();
    rerender(<PinnedMessages pins={[pin({ body: null, attachmentMimeType: 'image/jpeg' })]} canPin={false} onSeen={() => {}} onShowInChat={() => {}} onUnpin={() => {}} />);
    expect(screen.getByText(/Photo/)).toBeInTheDocument();
  });

  it('lets the central admin unpin, and "Show in chat" jumps to the message', () => {
    const onUnpin = vi.fn();
    const onShow = vi.fn();
    render(<PinnedMessages pins={[pin()]} canPin onSeen={() => {}} onShowInChat={onShow} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByRole('button', { name: /Pinned message/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in chat' }));
    expect(onShow).toHaveBeenCalledWith('m1');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(onUnpin).toHaveBeenCalledWith('m1');
  });
});

describe('MessageBubble — the central admin\'s messages', () => {
  const base = (over: Partial<ChatMessage>): ChatMessage => ({ id: 'x1', senderName: 'Grace', isOwn: false, body: 'Hello', createdAt: new Date().toISOString(), deleted: false, attachments: [], ...over });
  const handlers = { mediaBase: '/api/communities/c1/conversation', showSender: true, highlighted: false, onReply: () => {}, onMenu: () => {}, onReact: () => {}, onJumpTo: () => {}, onOpenPhoto: () => {} };

  it('stand out with a gold edge and a "Central message" label; an ordinary message does not', () => {
    const { container, rerender } = render(<MessageBubble m={base({ senderName: 'Stanley Ndoh', senderBadge: 'National Coordinator' })} {...handlers} />);
    expect(container.querySelector('[data-central="true"]')).not.toBeNull();
    expect(screen.getByText(/Central message/)).toBeInTheDocument();
    rerender(<MessageBubble m={base({})} {...handlers} />);
    expect(container.querySelector('[data-central="true"]')).toBeNull();
    expect(screen.queryByText(/Central message/)).not.toBeInTheDocument();
  });

  it('shows a pin mark on a pinned message', () => {
    render(<MessageBubble m={base({ pinned: true })} {...handlers} />);
    expect(screen.getByText(/Pinned message/)).toBeInTheDocument();
  });
});

describe('the group chat page with pins', () => {
  const G = 'g1';
  const msgs = [
    { id: 'm1', senderName: 'Stanley Ndoh', senderBadge: 'National Coordinator', senderPersonId: 'p-admin', isOwn: false, body: 'Conference on Saturday', createdAt: new Date().toISOString(), deleted: false, attachments: [], reactions: [], pinned: false },
  ];
  const routes = (info: Record<string, unknown>) => ({
    'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
    [`GET /api/communities/${G}/conversation/messages`]: () => ({ body: { items: msgs, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true } }),
    [`GET /api/communities/${G}/conversation`]: () => ({ body: { name: 'Buea Group', photoUrl: null, ...info } }),
    [`POST /api/communities/${G}/conversation/messages/m1/pin/seen`]: () => ({ body: { ok: true } }),
    [`PUT /api/communities/${G}/conversation/messages/m1/pin`]: () => ({ body: { pins: [pin({ messageId: 'm1', body: 'Conference on Saturday' })] } }),
    [`DELETE /api/communities/${G}/conversation/messages/m1/pin`]: () => ({ body: { pins: [] } }),
  });
  const renderChat = () =>
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the pinned message to a newcomer, with the gold chip; tapping it tells the server it was seen', async () => {
    mockFetch(routes({ pins: [pin({ unseen: true })], canPin: false }));
    renderChat();
    const chip = await screen.findByTestId('important-chip');
    fireEvent.click(chip);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/messages/m1/pin/seen'))).toBe(true));
    expect(screen.queryByTestId('important-chip')).not.toBeInTheDocument();
  });

  it('lets the central admin pin a message from its menu', async () => {
    mockFetch(routes({ pins: [], canPin: true }));
    renderChat();
    const bubble = await screen.findByText('Conference on Saturday');
    fireEvent.contextMenu(bubble);
    fireEvent.click(await screen.findByRole('button', { name: /Pin to top/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/messages/m1/pin'))).toBe(true));
    expect(await screen.findByText('Pinned to the top.')).toBeInTheDocument();
    expect(screen.getByTestId('pinned-messages')).toBeInTheDocument();
  });

  it('does not offer pinning to an ordinary member', async () => {
    mockFetch(routes({ pins: [], canPin: false }));
    renderChat();
    fireEvent.contextMenu(await screen.findByText('Conference on Saturday'));
    await screen.findByRole('button', { name: /Reply/ });
    expect(screen.queryByRole('button', { name: /Pin to top/ })).not.toBeInTheDocument();
  });
});
