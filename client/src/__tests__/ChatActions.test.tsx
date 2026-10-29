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
    await waitFor(() => expect(screen.getByText('Typo here')).toBeInTheDocument());
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
      source: { kind: 'group', chatId: G, messageId: 'm1', messageIds: ['m1'] },
      targets: [
        { kind: 'group', chatId: 'g2' },
        { kind: 'private', chatId: 'c1' },
      ],
    });
  });
});

describe('Selecting several messages (like WhatsApp)', () => {
  async function startSelecting() {
    renderChat();
    await screen.findByText('See the flyer');
    openMenu('See the flyer');
    fireEvent.click(screen.getByRole('button', { name: /Select messages/ }));
  }

  it('shows each selected message ticked, with a count, and lets you tick more by tapping', async () => {
    mockFetch(routes());
    await startSelecting();
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('1 selected');
    const first = screen.getByRole('checkbox', { name: 'Message from Ada Nkem' });
    expect(first).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Meeting at 6'));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 selected');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    // Tapping a ticked message unticks it; with none left the selection ends.
    fireEvent.click(screen.getByText('See the flyer'));
    fireEvent.click(screen.getByText('Meeting at 6'));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('copies the selected messages together, oldest first', async () => {
    mockFetch(routes());
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    await startSelecting();
    fireEvent.click(screen.getByText('Typo herre'));
    fireEvent.click(screen.getByText('Meeting at 6'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = (writeText.mock.calls[0] as unknown as string[])[0];
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/\] Ada Nkem: See the flyer$/);
    expect(lines[1]).toMatch(/\] Me Myself: Meeting at 6$/);
    expect(lines[2]).toMatch(/\] Me Myself: Typo herre$/);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('forwards all the selected messages in one go', async () => {
    mockFetch(routes({ 'POST /api/chat/forward': () => ({ status: 201, body: { sent: [{}] } }) }));
    await startSelecting();
    fireEvent.click(screen.getByText('Meeting at 6'));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Limbe Group/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 1 chat' }));
    expect(await screen.findByText('Forwarded to 1 chat')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/chat/forward')?.body.source).toEqual({ kind: 'group', chatId: G, messageId: 'm1', messageIds: ['m1', 'm2'] });
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('cancels with the ✕ and cannot select a deleted message', async () => {
    mockFetch(routes());
    await startSelecting();
    // The deleted message offers no tick box.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selection' }));
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('Forward without the "Forwarded" label (central admin only)', () => {
  const pickLimbe = async () => {
    renderChat();
    await screen.findByText('See the flyer');
    return screen;
  };

  it('shows the switch for the central admin on someone else\'s message and sends the choice', async () => {
    mockFetch(routes({
      'GET /api/chat/forward/options': () => ({ body: { canHideLabel: true } }),
      'POST /api/chat/forward': () => ({ status: 201, body: { sent: [{}] } }),
    }));
    await pickLimbe();
    openMenu('See the flyer');
    fireEvent.click(screen.getByRole('button', { name: /Forward/ }));
    const mark = await screen.findByRole('checkbox', { name: /Show .Forwarded. on this message/ });
    expect(mark).toBeChecked();
    fireEvent.click(mark);
    fireEvent.click(screen.getByRole('checkbox', { name: /Limbe Group/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 1 chat' }));
    await screen.findByText('Forwarded to 1 chat');
    expect(calls.find((c) => c.url === '/api/chat/forward')?.body.markForwarded).toBe(false);
  });

  it('shows no switch to anyone else', async () => {
    mockFetch(routes({ 'GET /api/chat/forward/options': () => ({ body: { canHideLabel: false } }) }));
    await pickLimbe();
    openMenu('See the flyer');
    fireEvent.click(screen.getByRole('button', { name: /Forward/ }));
    await screen.findByRole('checkbox', { name: /Limbe Group/ });
    expect(screen.queryByRole('checkbox', { name: /Show .Forwarded. on this message/ })).toBeNull();
  });

  it('tells the central admin their own message goes without the label', async () => {
    mockFetch(routes({ 'GET /api/chat/forward/options': () => ({ body: { canHideLabel: true } }) }));
    await pickLimbe();
    openMenu('Meeting at 6');
    fireEvent.click(screen.getByRole('button', { name: /Forward/ }));
    expect(await screen.findByText(/Your own message is sent without/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Show .Forwarded. on this message/ })).toBeNull();
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

describe('No mute option (members always get notified)', () => {
  it('the group info page has no mute button', async () => {
    mockFetch({
      [`GET /api/communities/${G}/conversation/members`]: () => ({ body: { members: [] } }),
      [`GET /api/communities/${G}/conversation`]: () => ({ body: { name: 'Buea Group' } }),
    });
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}/info`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId/info" element={<MemberGroupInfoPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Buea Group');
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument();
    expect(screen.queryByText('🔕')).not.toBeInTheDocument();
  });

  it('the Chats list always shows the unread count in green, with no muted badge', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
      [`GET /api/communities/${G}/conversation`]: () => ({ body: { unreadCount: 3, name: 'Buea Group', lastMessage: null } }),
    });
    render(
      <MemoryRouter>
        <MemberChatsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Muted')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('3 new messages')).toHaveClass('bg-emerald-600');
  });
});
