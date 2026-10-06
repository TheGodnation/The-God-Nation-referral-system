import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import { MemberPrivateChatPage } from '../pages/MemberPrivateChatPage';
import { AdminOnlineNow } from '../components/admin/AdminOnlineNow';

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

function groupBody(extra: Record<string, unknown> = {}) {
  return {
    items: [
      { id: 'g1', senderName: 'Me', isOwn: true, body: 'Prayer at 6pm', createdAt: now, deleted: false, attachments: [], reactions: [], status: 'read' },
      { id: 'g2', senderName: 'Me', isOwn: true, body: 'Bring your Bible', createdAt: now, deleted: false, attachments: [], reactions: [], status: 'sent' },
    ],
    hasMore: false,
    unreadCount: 0,
    isAdministrator: false,
    canPost: true,
    memberCount: 120,
    onlineCount: 12,
    typing: [],
    ...extra,
  };
}

function renderGroup() {
  return render(
    <MemoryRouter initialEntries={['/member/chats/group/c1']}>
      <Routes>
        <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Group chat: ticks, online count, typing, message info', () => {
  it('shows ticks and "120 members · 12 online"', async () => {
    mockFetch({ 'GET /api/communities/c1/conversation/messages': () => ({ body: groupBody() }) });
    renderGroup();
    expect(await screen.findByText('120 members · 12 online')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Seen' })).toHaveTextContent('✓✓');
    expect(screen.getByRole('img', { name: 'Sent' })).toHaveTextContent('✓');
  });

  it('shows who is typing', async () => {
    mockFetch({ 'GET /api/communities/c1/conversation/messages': () => ({ body: groupBody({ typing: ['Ada'] }) }) });
    renderGroup();
    expect(await screen.findByText('Ada is typing…')).toBeInTheDocument();
  });

  it('Message info shows "Seen by 1 of 2"', async () => {
    mockFetch({
      'GET /api/communities/c1/conversation/messages': () => ({ body: groupBody() }),
      'GET /api/communities/c1/conversation/messages/g2/info': () => ({
        body: {
          status: 'sent',
          total: 2,
          readBy: [{ personId: 'p1', name: 'Ada Obi', photoUrl: null }],
          deliveredTo: [{ personId: 'p2', name: 'Ben Tabe', photoUrl: null }],
        },
      }),
    });
    renderGroup();
    fireEvent.contextMenu(await screen.findByText('Bring your Bible'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Message options' })).getByRole('button', { name: /Message info/ }));
    const info = await screen.findByRole('dialog', { name: 'Message info' });
    expect(await within(info).findByText('✓✓ Seen by 1 of 2')).toBeInTheDocument();
    expect(within(info).getByText('Ada Obi')).toBeInTheDocument();
    expect(within(info).getByText('✓✓ Received, not yet seen (1)')).toBeInTheDocument();
  });

  it('typing in the box tells the others', async () => {
    mockFetch({
      'GET /api/communities/c1/conversation/messages': () => ({ body: groupBody() }),
      'POST /api/communities/c1/conversation/typing': () => ({ body: { ok: true } }),
    });
    renderGroup();
    await screen.findByText('Prayer at 6pm');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Am' } });
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/typing'))?.body).toEqual({ typing: true }));
  });
});

function privateBody(extra: Record<string, unknown> = {}) {
  return {
    items: [{ id: 'm1', isOwn: true, body: 'Hello Grace', createdAt: now, attachments: [], reactions: [], replyTo: null, status: 'delivered' }],
    hasMore: false,
    unreadCount: 0,
    otherPartyType: 'MEMBER',
    otherPartyName: 'Grace Ngwa',
    otherPartyPersonId: 'p2',
    otherPartyPhotoUrl: null,
    otherPartyPresence: { online: false, lastSeenAt: now },
    typing: false,
    ...extra,
  };
}

function renderPrivate() {
  return render(
    <MemoryRouter initialEntries={['/member/chats/private/c9']}>
      <Routes>
        <Route path="/member/chats/private/:conversationId" element={<MemberPrivateChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Private chat: ticks, online, last seen, typing', () => {
  it('shows grey ✓✓ and "last seen today at …"', async () => {
    mockFetch({ 'GET /api/private-messages/conversations/c9/messages': () => ({ body: privateBody() }) });
    renderPrivate();
    expect(await screen.findByText(/^last seen today at /)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Received' })).toHaveTextContent('✓✓');
  });

  it('shows "online"', async () => {
    mockFetch({ 'GET /api/private-messages/conversations/c9/messages': () => ({ body: privateBody({ otherPartyPresence: { online: true, lastSeenAt: now } }) }) });
    renderPrivate();
    expect(await screen.findByText('online')).toBeInTheDocument();
  });

  it('shows "typing…"', async () => {
    mockFetch({ 'GET /api/private-messages/conversations/c9/messages': () => ({ body: privateBody({ typing: true }) }) });
    renderPrivate();
    expect(await screen.findByText('typing…')).toBeInTheDocument();
  });
});

describe('Admin: online now', () => {
  it('shows the total and each group', async () => {
    mockFetch({
      'GET /api/admin/presence': () => ({
        body: { onlineNow: 58, groups: [{ communityId: 'c1', name: 'Buea Group', memberCount: 120, onlineCount: 12 }] },
      }),
    });
    render(<AdminOnlineNow />);
    expect(await screen.findByText('58 people online now')).toBeInTheDocument();
    expect(screen.getByText('Buea Group')).toBeInTheDocument();
    expect(screen.getByText('12 online of 120')).toBeInTheDocument();
  });
});
