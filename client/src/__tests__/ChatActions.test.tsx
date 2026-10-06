import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import { MemberGroupInfoPage } from '../pages/MemberGroupInfoPage';
import { MemberChatsPage } from '../pages/MemberChatsPage';
import { applyRecent } from '../lib/chatSync';
import type { ChatMessage } from '../components/chat/types';

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
  vi.restoreAllMocks();
  calls.length = 0;
  localStorage.clear();
});

const G = 'g1';
const now = new Date().toISOString();

const messages = [
  { id: 'm1', senderName: 'Ada Nkem', isOwn: false, body: 'See the flyer', createdAt: now, deleted: false, forwarded: true, attachments: [], replyTo: null, reactions: [] },
  { id: 'm2', senderName: 'Me Myself', isOwn: true, body: 'Meeting at 6', createdAt: now, deleted: false, edited: true, attachments: [], replyTo: null, reactions: [], status: 'read' },
  { id: 'm3', senderName: 'Ben Tabe', isOwn: false, body: null, createdAt: now, deleted: true, deletedBySender: true, attachments: [], replyTo: null, reactions: [] },
  { id: 'm4', senderName: 'Me Myself', isOwn: true, body: 'Typo herre', createdAt: now, deleted: false, attachments: [], replyTo: null, reactions: [], status: 'sent' },
];

function routes(extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  return {
    'GET /api/member/me/community-memberships': () => ({
      body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }, { communityId: 'g2', communityName: 'Limbe Group', status: 'ACTIVE' }] },
    }),
    [`GET /api/communities/${G}/conversation/messages`]: () => ({
      body: { items: messages, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true },
    }),
    'GET /api/private-messages/conversations': () => ({
      body: { items: [{ id: 'c1', otherPartyType: 'MEMBER', otherPartyName: 'Grace Ngwa', otherPartyPhotoUrl: null, unreadCount: 0 }] },
    }),
    ...extra,
  };
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
      <Routes>
        <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openMenu(text: string) {
  fireEvent.contextMenu(screen.getByText(text));
}

describe('Forwarded, edited and deleted messages', () => {
  it('shows "Forwarded", "edited" and "This message was deleted"', async () => {
    mockFetch(routes());
    renderChat();
    expect(await screen.findByText('See the flyer')).toBeInTheDocument();
    expect(screen.getByText(/Forwarded/)).toBeInTheDocument();
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.getByText(/This message was deleted/)).toBeInTheDocument();
  });

  it('light syncing brings edits and deletions', () => {
    const base: ChatMessage = { id: 'x', senderName: 'A', isOwn: false, body: 'old', createdAt: now, deleted: false, attachments: [] };
    const edited = applyRecent([base], [{ id: 'x', edited: true, body: 'new' }]);
    expect(edited[0]).toMatchObject({ body: 'new', edited: true });
    const gone = applyRecent(edited, [{ id: 'x', deleted: true, deletedBySender: true }]);
    expect(gone[0]).toMatchObject({ deleted: true, deletedBySender: true, body: null, edited: false });
  });
});

describe('Edit and delete for everyone', () => {
  it('edits my own message', async () => {
    mockFetch(routes({ [`PATCH /api/communities/${G}/conversation/messages/m4`]: (b) => ({ body: { id: 'm4', body: b.body, edited: true } }) }));
    renderChat();
    await screen.findByText('Typo herre');
    openMenu('Typo herre');
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const box = screen.getByLabelText('Edit message', { selector: 'textarea' });
    fireEvent.change(box, { target: { value: 'Typo here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Typo here')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ body: 'Typo here' });
  });

  it('only my own messages offer Edit and Delete for everyone', async () => {
    mockFetch(routes());
    renderChat();
    await screen.findByText('See the flyer');
    openMenu('See the flyer');
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete for everyone/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Forward/ })).toBeInTheDocument();
  });

  it('deletes my message for everyone', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch(routes({ [`POST /api/communities/${G}/conversation/messages/m4/unsend`]: () => ({ body: { id: 'm4', deleted: true } }) }));
    renderChat();
    await screen.findByText('Typo herre');
    openMenu('Typo herre');
    fireEvent.click(screen.getByRole('button', { name: /Delete for everyone/ }));
    expect(await screen.findByText(/You deleted this message/)).toBeInTheDocument();
    expect(screen.queryByText('Typo herre')).not.toBeInTheDocument();
  });
});

describe('Forward', () => {
  it('sends a copy to the chats I pick', async () => {
    mockFetch(routes({ 'POST /api/chat/forward': () => ({ status: 201, body: { sent: [{}, {}] } }) }));
    renderChat();
    await screen.findByText('See the flyer');
    openMenu('See the flyer');
    fireEvent.click(screen.getByRole('button', { name: /Forward/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Limbe Group/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Grace Ngwa/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2 chats' }));
    expect(await screen.findByText('Forwarded to 2 chats')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/chat/forward')?.body).toEqual({
      source: { kind: 'group', chatId: G, messageId: 'm1' },
      targets: [
        { kind: 'group', chatId: 'g2' },
        { kind: 'private', chatId: 'c1' },
      ],
    });
  });
});

describe('Search in a chat', () => {
  it('finds a message and jumps to it', async () => {
    mockFetch(
      routes({
        [`GET /api/communities/${G}/conversation/search`]: () => ({
          body: { items: [{ id: 'm2', senderName: 'Me Myself', isOwn: true, body: 'Meeting at 6', createdAt: now }] },
        }),
      }),
    );
    renderChat();
    await screen.findByText('See the flyer');
    fireEvent.click(screen.getByRole('button', { name: 'Search in this chat' }));
    fireEvent.change(screen.getByLabelText('Search messages…'), { target: { value: 'meeting' } });
    const hit = await screen.findByRole('button', { name: /Meeting at 6/ }, { timeout: 2000 });
    expect(calls.some((c) => c.url.includes('/conversation/search?q=meeting'))).toBe(true);
    fireEvent.click(hit);
    await waitFor(() => expect(screen.queryByLabelText('Search messages…')).not.toBeInTheDocument());
  });
});

describe('Mute a group', () => {
  it('mutes from the group info page', async () => {
    mockFetch({
      [`GET /api/communities/${G}/conversation/members`]: () => ({ body: { members: [] } }),
      [`GET /api/communities/${G}/conversation`]: () => ({ body: { name: 'Buea Group', muted: false } }),
      [`PUT /api/communities/${G}/conversation/mute`]: () => ({ body: { muted: true, mutedUntil: null } }),
    });
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}/info`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId/info" element={<MemberGroupInfoPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Always' }));
    expect(await screen.findByText('Muted always')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ for: 'always' });
  });

  it('a muted group shows 🔕 and a grey count in the Chats list', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
      [`GET /api/communities/${G}/conversation`]: () => ({ body: { unreadCount: 3, name: 'Buea Group', muted: true, lastMessage: null } }),
    });
    render(
      <MemoryRouter>
        <MemberChatsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Muted')).toBeInTheDocument();
    expect(screen.getByLabelText('3 new messages')).toHaveClass('bg-slate-400');
  });
});
