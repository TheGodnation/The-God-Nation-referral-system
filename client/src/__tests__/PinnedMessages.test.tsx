import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PinnedMessages, type ChatPin } from '../components/chat/PinnedMessages';
import { MemberPinnedPage } from '../pages/MemberPinnedPage';
import { MemberTeachingPage } from '../pages/MemberTeachingPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
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

describe('PinnedMessages (the strip under the chat header)', () => {
  it('shows nothing when nothing is pinned', () => {
    const { container } = render(<PinnedMessages pins={[]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows how many are done, the next one to do, and opens the Pinned page at it', () => {
    const onOpen = vi.fn();
    const pins = [
      pin({ messageId: 'b', body: 'Lesson 2', createdAt: '2026-11-02T10:00:00Z', done: false }),
      pin({ messageId: 'a', body: 'Lesson 1', createdAt: '2026-11-01T10:00:00Z', done: true }),
      pin({ messageId: 'c', body: 'Lesson 3', createdAt: '2026-11-03T10:00:00Z', done: false }),
    ];
    render(<PinnedMessages pins={pins} onOpen={onOpen} />);
    const bar = screen.getByTestId('pinned-messages');
    expect(bar).toHaveTextContent('Pinned messages');
    expect(screen.getByTestId('pinned-count')).toHaveTextContent('3');
    expect(bar).toHaveTextContent('1 of 3 done');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByTestId('pinned-next-preview')).toHaveTextContent('Lesson 2'); // the first one not done, in the order written
    expect(screen.queryByTestId('important-chip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pinned-open'));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('when everything is done it offers to open them again, from the first', () => {
    const onOpen = vi.fn();
    render(<PinnedMessages pins={[pin({ messageId: 'a', done: true }), pin({ messageId: 'b', done: true, createdAt: '2026-11-02T10:00:00Z' })]} onOpen={onOpen} />);
    expect(screen.getByTestId('pinned-open')).toHaveTextContent('Open');
    fireEvent.click(screen.getByTestId('pinned-open'));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('shows the heading of the next message, without its symbols', () => {
    render(<PinnedMessages pins={[pin({ body: '## Walking in Dominion\n\nThe first lesson is about authority.' })]} onOpen={() => {}} />);
    const next = screen.getByTestId('pinned-next-preview');
    expect(next).toHaveTextContent('Walking in Dominion');
    expect(next).not.toHaveTextContent('##');
  });

  it('a teaching shows its title as the heading', () => {
    render(<PinnedMessages pins={[pin({ body: null, teachingTitle: 'The Kingdom of God', teachingId: 'tc1' })]} onOpen={() => {}} />);
    expect(screen.getByTestId('pinned-next-preview')).toHaveTextContent('The Kingdom of God');
  });

  it('turns gold with a "new" badge and "Read now" when something new is pinned, and opens that one', () => {
    const onOpen = vi.fn();
    render(<PinnedMessages pins={[pin({ messageId: 'a', done: true }), pin({ messageId: 'n', unseen: true, createdAt: '2026-11-02T10:00:00Z' })]} onOpen={onOpen} />);
    expect(screen.getByTestId('important-chip')).toHaveTextContent('1 new');
    expect(screen.getByTestId('pinned-open')).toHaveTextContent('Read');
    expect(screen.getByTestId('pinned-messages').className).toContain('bg-amber-100');
    fireEvent.click(screen.getByTestId('pinned-open'));
    expect(onOpen).toHaveBeenCalledWith('n');
  });

  it('shows a translation, a teaching or a picture as words in the preview', () => {
    const { rerender } = render(<PinnedMessages pins={[pin({ body: 'Bonjour à tous', translation: { sourceLanguage: 'fr', translatedBody: 'Hello everyone' } })]} onOpen={() => {}} />);
    expect(screen.getByText('Hello everyone')).toBeInTheDocument();
    rerender(<PinnedMessages pins={[pin({ body: null, teachingTitle: 'Walking in Dominion' })]} onOpen={() => {}} />);
    expect(screen.getByText('Walking in Dominion')).toBeInTheDocument();
    rerender(<PinnedMessages pins={[pin({ body: null, attachmentMimeType: 'image/jpeg' })]} onOpen={() => {}} />);
    expect(screen.getByText(/Photo/)).toBeInTheDocument();
  });
});

describe('the Pinned page', () => {
  const G = 'g1';
  const lesson = (n: number, over: Partial<ChatPin> = {}) => pin({ messageId: `m${n}`, body: `Lesson ${n}`, createdAt: `2026-11-0${n}T10:00:00Z`, unseen: true, done: false, ...over });
  const pageRoutes = (pins: ChatPin[], extra: Record<string, (b: any) => { status?: number; body: unknown }> = {}, canPin = false) => ({
    [`GET /api/communities/${G}/conversation`]: () => ({ body: { name: 'Buea Group', canPin, pins } }),
    [`POST /api/communities/${G}/conversation/messages/`]: () => ({ body: { ok: true } }),
    [`GET /api/communities/${G}/conversation/pins/m1/comments`]: () => ({ body: { items: [{ id: 'c1', senderName: 'Ada Nkem', isOwn: false, body: 'Amen!', createdAt: '2026-11-01T11:00:00Z' }] } }),
    [`GET /api/communities/${G}/conversation/pins/m2/comments`]: () => ({ body: { items: [] } }),
    ...extra,
  });
  const renderPage = (path = `/member/chats/group/${G}/pinned`) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/member/chats/group/:communityId/pinned/:messageId?" element={<MemberPinnedPage />} />
          <Route path="/member/chats/group/:communityId" element={<p>The chat</p>} />
          <Route path="/member/teachings/:id" element={<p>The teaching page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('opens at the first one not done, shows the whole post with its comments, and counts it as read', async () => {
    mockFetch(pageRoutes([lesson(1, { done: true }), lesson(2), lesson(3)]));
    renderPage();
    expect(await screen.findByTestId('pinned-post')).toHaveTextContent('Lesson 2');
    expect(screen.getByTestId('pinned-position')).toHaveTextContent('2 of 3');
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/messages/m2/pin/seen'))).toBe(true));
    // The first one, done, shows a tick.
    expect(screen.getByRole('link', { name: '✓' })).toBeInTheDocument();
  });

  it('shows the comments under a post and sends a new one as a reply to it', async () => {
    mockFetch(pageRoutes([lesson(1)]));
    renderPage(`/member/chats/group/${G}/pinned/m1`);
    expect(await screen.findByText('Amen!')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Write a comment…'), { target: { value: 'Thank you, Pastor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'))!.body).toEqual({ body: 'Thank you, Pastor', replyToMessageId: 'm1' });
  });

  it('goes on from one pin to the next, in the order written, and the last one ends with Finish back to the chat', async () => {
    mockFetch(pageRoutes([lesson(2), lesson(1)]));
    renderPage(`/member/chats/group/${G}/pinned/m1`);
    expect(await screen.findByTestId('pinned-post')).toHaveTextContent('Lesson 1');
    expect(screen.queryByRole('link', { name: /Previous/ })).toBeNull();
    // Next is at the top as well as at the bottom, so it is clear at once that there is more.
    expect(screen.getByTestId('pinned-nav-top')).toHaveTextContent('Next');
    expect(screen.getByTestId('pinned-nav-bottom')).toHaveTextContent('Next');
    fireEvent.click(screen.getByTestId('pinned-next-top'));
    await waitFor(() => expect(screen.getByTestId('pinned-post')).toHaveTextContent('Lesson 2'));
    expect(screen.getAllByRole('link', { name: /Previous/ })).toHaveLength(2); // top and bottom
    expect(screen.queryByTestId('pinned-next')).toBeNull();
    fireEvent.click(screen.getByTestId('pinned-finish'));
    expect(await screen.findByText('The chat')).toBeInTheDocument();
  });

  it('a teaching opens its own page (reading and quiz) straight away, on the pinned trail', async () => {
    mockFetch(pageRoutes([lesson(1, { body: null, teachingId: 'tc1', teachingTitle: 'Walking in Dominion' })]));
    renderPage(`/member/chats/group/${G}/pinned/m1`);
    expect(await screen.findByText('The teaching page')).toBeInTheDocument();
  });

  it('fetches the whole of a long post', async () => {
    mockFetch(pageRoutes([lesson(1, { body: 'The start…', bodyTruncated: true })], { [`GET /api/communities/${G}/conversation/pins/m1`]: () => ({ body: { body: '## The Government of God\n\nThe whole post.', translation: null } }) }));
    renderPage(`/member/chats/group/${G}/pinned/m1`);
    expect(await screen.findByText('The Government of God')).toHaveClass('font-bold');
    expect(screen.getByText('The whole post.')).toBeInTheDocument();
  });

  it('lets the central admin unpin from the page', async () => {
    mockFetch(pageRoutes([lesson(1)], { [`DELETE /api/communities/${G}/conversation/messages/m1/pin`]: () => ({ body: { pins: [] } }) }, true));
    renderPage(`/member/chats/group/${G}/pinned/m1`);
    fireEvent.click(await screen.findByRole('button', { name: 'Unpin' }));
    expect(await screen.findByText('The chat')).toBeInTheDocument();
  });

  it('an ordinary member is not offered Unpin', async () => {
    mockFetch(pageRoutes([lesson(1)]));
    renderPage(`/member/chats/group/${G}/pinned/m1`);
    await screen.findByTestId('pinned-post');
    expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull();
  });
});

describe('a teaching opened from the pinned messages', () => {
  it('shows where it is among the pins, offers the next one, and keeps the trail on the quiz link', async () => {
    const G = 'g1';
    const CLOSES = new Date(Date.now() + 5 * 86400000).toISOString();
    const detail = {
      id: 'tc1', title: 'Walking in Dominion', text: 'Read this', communityId: G, communityName: 'Buea Group', messageId: 'm1', authorName: 'Coordinator', isAuthor: false,
      closesAt: CLOSES, mediaKind: null, attachments: [], minReadSeconds: 0, canManage: false,
      quiz: { assessmentId: 'as1', passMark: 70, questionCount: 5, state: 'AVAILABLE', percentage: null, passed: null },
      me: { textRead: true, mediaFraction: 0, mediaDone: false, completed: true },
    };
    mockFetch({
      [`GET /api/teachings/tc1/results`]: () => ({ body: { totals: { members: 1, opened: 1, finished: 1, taken: 0, passed: 0, averagePercentage: null }, passMark: 70, closesAt: CLOSES, participants: [] } }),
      [`GET /api/teachings/tc1`]: () => ({ body: detail }),
      [`POST /api/teachings/tc1/progress`]: () => ({ body: { me: detail.me, quiz: detail.quiz } }),
      [`GET /api/communities/${G}/conversation`]: () => ({ body: { name: 'Buea Group', pins: [pin({ messageId: 'm1', body: null, teachingId: 'tc1', createdAt: '2026-11-01T10:00:00Z' }), pin({ messageId: 'm2', body: 'Lesson 2', createdAt: '2026-11-02T10:00:00Z' })] } }),
    });
    render(
      <MemoryRouter initialEntries={[`/member/teachings/tc1?pins=${G}`]}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/teachings/:id" element={<MemberTeachingPage />} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('pinned-trail-top')).toHaveTextContent('Pinned 1 of 2');
    expect(await screen.findByTestId('pinned-trail-next-top')).toHaveAttribute('href', `/member/chats/group/${G}/pinned/m2`);
    const next = await screen.findByRole('link', { name: /Next pinned message/ });
    expect(next).toHaveAttribute('href', `/member/chats/group/${G}/pinned/m2`);
    expect(screen.getByTestId('teaching-start-quiz')).toHaveAttribute('href', `/member/assessments/as1?pins=${G}`);
  });
});

describe('MessageBubble — the central admin\'s messages', () => {
  const base = (over: Partial<ChatMessage>): ChatMessage => ({ id: 'x1', senderName: 'Grace', isOwn: false, body: 'Hello', createdAt: new Date().toISOString(), deleted: false, attachments: [], ...over });
  const handlers = { mediaBase: '/api/communities/c1/conversation', showSender: true, highlighted: false, onReply: () => {}, onMenu: () => {}, onReact: () => {}, onJumpTo: () => {}, onOpenPhoto: () => {} };

  it('holding a teaching card opens the menu, and letting go does not open the teaching; in selection mode a tap ticks it', () => {
    vi.useFakeTimers();
    try {
      const onMenu = vi.fn();
      const onToggle = vi.fn();
      const teaching = base({ id: 't1', body: null, teaching: { id: 'tc1', title: 'Walking in Dominion', hasText: true, mediaKind: null, closesAt: new Date(Date.now() + 86400000).toISOString(), myState: 'NOT_OPENED' } as never });
      const ui = (extra: Record<string, unknown> = {}) => (
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<MessageBubble m={teaching} {...handlers} onMenu={onMenu} {...extra} />} />
            <Route path="/member/teachings/:id" element={<p>The teaching page</p>} />
          </Routes>
        </MemoryRouter>
      );
      const { unmount } = render(ui());
      const card = screen.getByTestId('teaching-card');
      // Finger down on the card, held for a moment: the message menu opens.
      fireEvent.touchStart(card, { touches: [{ clientX: 10, clientY: 10 }] });
      vi.advanceTimersByTime(500);
      expect(onMenu).toHaveBeenCalledWith(teaching);
      // The finger lifts: the browser sends a tap to the card. It must not open the teaching.
      fireEvent.touchEnd(card);
      fireEvent.click(card);
      expect(screen.queryByText('The teaching page')).toBeNull();
      // A normal tap, much later, still opens it.
      vi.advanceTimersByTime(2000);
      fireEvent.click(screen.getByTestId('teaching-card'));
      expect(screen.getByText('The teaching page')).toBeInTheDocument();
      unmount();

      // In selection mode, tapping the card ticks the message instead of opening it.
      const picking = render(ui({ selecting: true, selected: false, onToggleSelect: onToggle }));
      fireEvent.click(screen.getByTestId('teaching-card'));
      expect(onToggle).toHaveBeenCalledWith(teaching);
      expect(screen.queryByText('The teaching page')).toBeNull();
      picking.unmount();
      render(ui({ selecting: true, selected: true, onToggleSelect: onToggle }));
      expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('shows the pinned message to a newcomer with the gold chip; tapping it opens the Pinned page', async () => {
    mockFetch(routes({ pins: [pin({ unseen: true })], canPin: false }));
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
          <Route path="/member/chats/group/:communityId/pinned/:messageId" element={<p>The pinned page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('important-chip'));
    expect(await screen.findByText('The pinned page')).toBeInTheDocument();
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
