import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    // The last one has no "Next": it ends with "Finish", which goes back to the chat.
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    expect(screen.queryByTestId('pinned-reader')).toBeNull();
  });

  it('reads them one after another, in the order they were written, then returns to the chat; opening again starts from the first', () => {
    const onSeen = vi.fn();
    const pins = [
      pin({ messageId: 'c', body: 'Lesson 3', createdAt: '2026-11-03T10:00:00Z', unseen: true }),
      pin({ messageId: 'a', body: 'Lesson 1', createdAt: '2026-11-01T10:00:00Z', unseen: true }),
      pin({ messageId: 'b', body: 'Lesson 2', createdAt: '2026-11-02T10:00:00Z', unseen: true }),
    ];
    render(<PinnedMessages pins={pins} canPin={false} onSeen={onSeen} onShowInChat={() => {}} onUnpin={() => {}} />);
    fireEvent.click(screen.getByTestId('important-chip'));
    const reader = () => screen.getByTestId('pinned-reader');
    expect(reader()).toHaveTextContent('Lesson 1');
    expect(screen.getByTestId('pinned-messages')).toHaveTextContent('Pinned 1 of 3');
    expect(screen.queryByRole('button', { name: /Previous/ })).toBeNull(); // nothing before the first
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(reader()).toHaveTextContent('Lesson 2');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(reader()).toHaveTextContent('Lesson 3');
    expect(onSeen.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']); // each one counted as read as it is reached
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    expect(screen.queryByTestId('pinned-reader')).toBeNull();
    // Opened again (nothing unseen now), it starts from the first.
    fireEvent.click(screen.getByTestId('pinned-messages').querySelector('button')!);
    expect(reader()).toHaveTextContent('Lesson 1');
  });

  it('a long teaching is fetched in full when it is read, and shown with its headings', async () => {
    const loadFull = vi.fn(async () => ({ body: '## The Government of God\n\nThe whole teaching, from start to end.', translation: null }));
    render(<PinnedMessages pins={[pin({ messageId: 'long', body: 'The start…', bodyTruncated: true })]} canPin={false} onSeen={() => {}} onShowInChat={() => {}} onUnpin={() => {}} loadFull={loadFull} />);
    fireEvent.click(screen.getByRole('button', { name: /Pinned message/ }));
    expect(await screen.findByText('The Government of God')).toHaveClass('font-bold');
    expect(screen.getByText('The whole teaching, from start to end.')).toBeInTheDocument();
    expect(loadFull).toHaveBeenCalledWith('long');
    expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument(); // a single pin ends with "Close"
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

  it('with many pins, "See all" lists every one and opens the one you tap', () => {
    const onShow = vi.fn();
    const onSeen = vi.fn();
    const pins = Array.from({ length: 14 }, (_, i) => pin({ messageId: `m${i}`, body: `Teaching number ${i + 1}`, unseen: i === 13 }));
    render(<PinnedMessages pins={pins} canPin={false} onSeen={onSeen} onShowInChat={onShow} onUnpin={() => {}} />);
    fireEvent.click(screen.getByTestId('important-chip'));
    fireEvent.click(screen.getByRole('button', { name: 'See all 14' }));
    const list = screen.getByTestId('pinned-list');
    expect(list.querySelectorAll('li')).toHaveLength(14);
    fireEvent.click(within(list).getByText('Teaching number 14'));
    expect(onSeen).toHaveBeenCalledWith('m13');
    expect(onShow).toHaveBeenCalledWith('m13');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the list' }));
    expect(screen.queryByTestId('pinned-list')).toBeNull();
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

  it('lets the central admin select several messages and pin them all at once', async () => {
    const many = [
      { ...msgs[0], id: 'm1', body: 'Teaching one' },
      { ...msgs[0], id: 'm2', body: 'Teaching two' },
      { ...msgs[0], id: 'm3', body: 'Teaching three' },
    ];
    mockFetch({
      ...routes({ pins: [], canPin: true }),
      [`GET /api/communities/${G}/conversation/messages`]: () => ({ body: { items: many, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true } }),
      [`POST /api/communities/${G}/conversation/pins`]: (b: any) => ({ body: { pins: b.messageIds.map((id: string) => pin({ messageId: id, body: `pinned ${id}` })), changed: b.messageIds.length } }),
    });
    renderChat();
    fireEvent.contextMenu(await screen.findByText('Teaching one'));
    fireEvent.click(await screen.findByRole('button', { name: /Select/ }));
    fireEvent.click(screen.getByText('Teaching two'));
    fireEvent.click(screen.getByText('Teaching three'));
    const bar = await screen.findByTestId('selection-bar');
    fireEvent.click(within(bar).getByRole('button', { name: /Pin$/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversation/pins'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/conversation/pins'))!.body).toEqual({ action: 'PIN', messageIds: ['m1', 'm2', 'm3'] });
    expect(await screen.findByText('3 messages pinned')).toBeInTheDocument();
    expect(screen.getByTestId('pinned-messages')).toBeInTheDocument();
  });

  it('an ordinary member selecting messages is not offered Pin', async () => {
    mockFetch({ ...routes({ pins: [], canPin: false }) });
    renderChat();
    fireEvent.contextMenu(await screen.findByText('Conference on Saturday'));
    fireEvent.click(await screen.findByRole('button', { name: /Select/ }));
    const bar = await screen.findByTestId('selection-bar');
    expect(within(bar).queryByRole('button', { name: /Pin/ })).toBeNull();
  });

  it('does not offer pinning to an ordinary member', async () => {
    mockFetch(routes({ pins: [], canPin: false }));
    renderChat();
    fireEvent.contextMenu(await screen.findByText('Conference on Saturday'));
    await screen.findByRole('button', { name: /Reply/ });
    expect(screen.queryByRole('button', { name: /Pin to top/ })).not.toBeInTheDocument();
  });
});
