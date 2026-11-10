import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MyLeaderCard } from '../components/member/MyLeaderCard';
import { PrivateChatList } from '../components/chat/PrivateChatList';
import { LeaderInstructions } from '../components/leader/LeaderInstructions';
import { resetMyLeaderCacheForTests } from '../lib/useMyLeader';

// "Your leader": a card on the person's Home page, a label in their private chats, and a link in an instruction's
// private message that opens that instruction.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
const LEADER = { personId: 'l1', name: 'Grace Mbah', photoUrl: null };

beforeEach(() => resetMyLeaderCacheForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Your leader card', () => {
  it('shows who from the Leadership Team follows the person up, with a way to write to them', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ leader: LEADER })));
    render(<MemoryRouter><MyLeaderCard /></MemoryRouter>);
    const card = await screen.findByTestId('my-leader-card');
    expect(card).toHaveTextContent('Your leader');
    expect(card).toHaveTextContent('Grace Mbah');
    expect(card).toHaveTextContent('From the Leadership Team');
    expect(screen.getByTestId('my-leader-message')).toHaveAttribute('href', '/member/people/l1');
  });

  it('shows nothing when nobody has been assigned', async () => {
    const fetchMock = vi.fn(() => json({ leader: null }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><MyLeaderCard /></MemoryRouter>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('my-leader-card')).toBeNull();
  });
});

describe('Your leader label in the private chats', () => {
  it('marks the conversation with your leader, and only that one', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/member/my-leader')) return json({ leader: LEADER });
      return json({ items: [
        { id: 'c1', createdAt: '2026-11-10T10:00:00Z', otherPartyType: 'LEADER', otherPartyName: 'Grace Mbah', otherPartyPersonId: 'l1', unreadCount: 0, lastMessage: null },
        { id: 'c2', createdAt: '2026-11-10T09:00:00Z', otherPartyType: 'MEMBER', otherPartyName: 'Someone Else', otherPartyPersonId: 'p9', unreadCount: 0, lastMessage: null },
      ] });
    }));
    render(<MemoryRouter><PrivateChatList /></MemoryRouter>);
    await screen.findByText('Grace Mbah');
    await waitFor(() => expect(screen.getAllByTestId('your-leader-badge')).toHaveLength(1));
    expect(screen.getByTestId('your-leader-badge')).toHaveTextContent('Your leader · Leadership Team');
    const rows = screen.getAllByRole('link');
    expect(rows.find((r) => r.textContent?.includes('Grace Mbah'))).toContainElement(screen.getByTestId('your-leader-badge'));
    expect(rows.find((r) => r.textContent?.includes('Someone Else'))?.querySelector('[data-testid="your-leader-badge"]')).toBeNull();
  });
});

describe('The link in an instruction\'s private message', () => {
  const item = (id: string) => ({ id, title: `Instruction ${id}`, body: 'Do this.', language: 'en', titleTr: null, bodyTr: null, dueAt: null, createdAt: '2026-11-10T10:00:00Z', sender: 'NATIONAL_COORDINATOR', status: 'WAITING', seenAt: null, doneAt: null, note: null, replies: [] });

  it('opens that instruction straight away and marks it Seen', async () => {
    window.history.pushState({}, '', '/member/leadership-dashboard?section=instructions&instruction=b');
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(url); return json({ ok: true }); }
      return json({ items: [item('a'), item('b')] });
    }));
    render(<LeaderInstructions />);
    expect(await screen.findByTestId('instruction-body-b')).toHaveTextContent('Do this.');
    expect(screen.queryByTestId('instruction-body-a')).toBeNull();
    await waitFor(() => expect(posts.some((u) => u.endsWith('/b/seen'))).toBe(true));
    expect(posts.some((u) => u.endsWith('/a/seen'))).toBe(false);
    // Tapping the open one closes it, as before.
    fireEvent.click(screen.getByTestId('leader-instruction-b'));
    await waitFor(() => expect(screen.queryByTestId('instruction-body-b')).toBeNull());
  });

  it('leaves every instruction closed when there is no link', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item('a')] })));
    render(<LeaderInstructions />);
    await screen.findByTestId('leader-instruction-a');
    expect(screen.queryByTestId('instruction-body-a')).toBeNull();
  });
});
