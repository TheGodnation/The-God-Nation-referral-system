import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberPrivateChatPage } from '../pages/MemberPrivateChatPage';
import { PrivateChatList } from '../components/chat/PrivateChatList';

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
      const res = key ? routes[key](body) : { status: 404, body: {} };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const now = new Date().toISOString();
const BASE = '/api/private-messages/conversations/c1';

const MESSAGES = {
  items: [
    { id: 'm1', isOwn: false, body: 'Are you coming to the prayer?', createdAt: now, attachments: [], replyTo: null, reactions: [{ emoji: '🙏', count: 1, mine: true }] },
    {
      id: 'm2',
      isOwn: true,
      body: 'Yes, I will',
      createdAt: now,
      attachments: [],
      replyTo: { id: 'm1', isOwn: false, body: 'Are you coming to the prayer?', attachmentMimeType: null },
      reactions: [],
    },
  ],
  hasMore: false,
  unreadCount: 0,
  otherPartyType: 'MEMBER',
  otherPartyName: 'Grace Ngwa',
  otherPartyPersonId: 'p2',
  otherPartyPhotoUrl: '/api/people/p2/photo?v=1',
};

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/member/chats/private/c1']}>
      <Routes>
        <Route path="/member/chats/private/:conversationId" element={<MemberPrivateChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Private chat screen (WhatsApp style)', () => {
  it("shows the person's photo and name, bubbles, and the reply quote", async () => {
    mockFetch({ [`GET ${BASE}/messages`]: () => ({ body: MESSAGES }) });
    renderChat();
    expect(await screen.findByRole('heading', { name: 'Grace Ngwa' })).toBeInTheDocument();
    expect(screen.getByAltText('Grace Ngwa')).toHaveAttribute('src', '/api/people/p2/photo?v=1');
    expect(screen.getByRole('link', { name: /Grace Ngwa/ })).toHaveAttribute('href', '/member/people/p2');
    expect(await screen.findByText('Yes, I will')).toBeInTheDocument();
    expect(screen.getAllByText('Are you coming to the prayer?')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '🙏 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Hold to record a voice note/ })).toBeInTheDocument();
  });

  it('reply to a message and send', async () => {
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({ body: MESSAGES }),
      [`POST ${BASE}/messages`]: () => ({ status: 201, body: { id: 'm3' } }),
    });
    renderChat();
    fireEvent.contextMenu(await screen.findByText('Yes, I will'));
    const sheet = await screen.findByRole('dialog', { name: 'Message options' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Reply/ }));
    expect(screen.getByText('Replying to You')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'See you there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url === `${BASE}/messages`)?.body).toEqual({ body: 'See you there', replyToMessageId: 'm2' }),
    );
  });

  it('react from the options sheet', async () => {
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({ body: MESSAGES }),
      [`PUT ${BASE}/messages/m2/reaction`]: () => ({ body: { reactions: [{ emoji: '❤️', count: 1, mine: true }] } }),
    });
    renderChat();
    fireEvent.contextMenu(await screen.findByText('Yes, I will'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Message options' })).getByRole('button', { name: 'React with ❤️' }));
    expect(await screen.findByRole('button', { name: '❤️ 1' })).toBeInTheDocument();
  });

  it('headquarters chats show the ministry name', async () => {
    mockFetch({ [`GET ${BASE}/messages`]: () => ({ body: { ...MESSAGES, otherPartyType: 'CENTRAL_AUTHORITY', otherPartyName: undefined, otherPartyPersonId: undefined } }) });
    renderChat();
    expect(await screen.findByRole('heading', { name: "God's Nation Headquarters" })).toBeInTheDocument();
  });
});

describe('Private chats in the Chats list', () => {
  it('rows show photo, name, last message, time and unread count, newest first', async () => {
    const earlier = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    mockFetch({
      'GET /api/private-messages/conversations': () => ({
        body: {
          items: [
            { id: 'a', createdAt: earlier, otherPartyType: 'MEMBER', otherPartyName: 'Ada Obi', otherPartyPhotoUrl: null, unreadCount: 0, lastMessage: { body: 'Hello', attachmentMimeType: null, isOwn: true, createdAt: earlier } },
            { id: 'b', createdAt: earlier, otherPartyType: 'LEADER', otherPartyName: 'Pastor Ben', otherPartyPhotoUrl: null, unreadCount: 2, lastMessage: { body: '', attachmentMimeType: 'image/jpeg', isOwn: false, createdAt: now } },
          ],
        },
      }),
    });
    render(
      <MemoryRouter>
        <PrivateChatList />
      </MemoryRouter>,
    );
    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveTextContent('Pastor Ben');
    expect(links[0]).toHaveTextContent('📷 Photo');
    expect(links[0]).toHaveAttribute('href', '/member/chats/private/b');
    expect(within(links[0]).getByLabelText('2 new messages')).toBeInTheDocument();
    expect(links[1]).toHaveTextContent('You: Hello');
  });
});
