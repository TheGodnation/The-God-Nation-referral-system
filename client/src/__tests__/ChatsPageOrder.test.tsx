import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberChatsPage } from '../pages/MemberChatsPage';

function mockFetch(routes: Record<string, () => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key]() : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const memberships = {
  items: [
    // Deliberately not in the final order.
    { communityId: 'g2', communityName: 'Zion Assembly', status: 'ACTIVE', generation: 2 },
    { communityId: 'g1b', communityName: 'Leadership Team', status: 'ACTIVE', generation: 1 },
    { communityId: 'hq', communityName: 'The God Nation HQ', status: 'ACTIVE', generation: 0 },
    { communityId: 'g1a', communityName: 'Alpha Assembly', status: 'ACTIVE', generation: 1 },
  ],
};

describe('Chats page', () => {
  it('keeps assemblies in a fixed order: Headquarters, then each generation by name', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: memberships }),
      'GET /api/communities/': () => ({ body: { unreadCount: 0 } }),
      'GET /api/private-messages/conversations': () => ({ body: { items: [] } }),
    });
    render(<MemoryRouter><MemberChatsPage /></MemoryRouter>);
    await screen.findByRole('link', { name: /The God Nation HQ/ });
    const rows = screen.getAllByRole('link').map((l) => l.getAttribute('href')).filter((h) => h?.startsWith('/member/chats/group/'));
    expect(rows).toEqual(['/member/chats/group/hq', '/member/chats/group/g1a', '/member/chats/group/g1b', '/member/chats/group/g2']);
  });

  it('keeps the Leadership Team (the former Headquarters) right under the Headquarters', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({
        body: {
          items: [
            { communityId: 'g1a', communityName: 'Alpha Assembly', status: 'ACTIVE', generation: 1 },
            { communityId: 'lt', communityName: 'Zeta Leadership Team', status: 'ACTIVE', generation: 1, isLeadershipTeam: true },
            { communityId: 'hq', communityName: 'The God Nation HQ', status: 'ACTIVE', generation: 0 },
          ],
        },
      }),
      'GET /api/communities/': () => ({ body: { unreadCount: 0 } }),
      'GET /api/private-messages/conversations': () => ({ body: { items: [] } }),
    });
    render(<MemoryRouter><MemberChatsPage /></MemoryRouter>);
    await screen.findByRole('link', { name: /Zeta Leadership Team/ });
    const rows = screen.getAllByRole('link').map((l) => l.getAttribute('href')).filter((h) => h?.startsWith('/member/chats/group/'));
    expect(rows).toEqual(['/member/chats/group/hq', '/member/chats/group/lt', '/member/chats/group/g1a']);
  });

  it('opens on the Private messages tab when there are new private messages, with red numbers on both tabs', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: memberships }),
      'GET /api/communities/hq/conversation': () => ({ body: { unreadCount: 4 } }),
      'GET /api/communities/': () => ({ body: { unreadCount: 0 } }),
      'GET /api/private-messages/conversations': () => ({
        body: {
          items: [
            { id: 'p1', createdAt: '2026-01-01T10:00:00Z', otherPartyType: 'MEMBER', otherPartyName: 'Older Person', unreadCount: 0, lastMessage: { body: 'old', attachmentMimeType: null, isOwn: false, createdAt: '2026-01-01T10:00:00Z' } },
            { id: 'p2', createdAt: '2026-01-02T10:00:00Z', otherPartyType: 'MEMBER', otherPartyName: 'Newest Person', unreadCount: 2, lastMessage: { body: 'hello', attachmentMimeType: null, isOwn: false, createdAt: '2026-02-02T10:00:00Z' } },
          ],
        },
      }),
    });
    render(<MemoryRouter><MemberChatsPage /></MemoryRouter>);
    const privateTab = await screen.findByRole('tab', { name: /Private messages/ }, { timeout: 5000 });
    await screen.findByText('Newest Person', undefined, { timeout: 5000 });
    await waitFor(() => expect(privateTab).toHaveAttribute('aria-selected', 'true'), { timeout: 5000 });
    expect(within(privateTab).getByLabelText('2 new messages')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /Assemblies/ })).getByLabelText('4 new messages')).toBeInTheDocument();
    // Newest first.
    const names = screen.getAllByText(/Person$/).map((n) => n.textContent);
    expect(names).toEqual(['Newest Person', 'Older Person']);
    // The member can still switch back.
    fireEvent.click(screen.getByRole('tab', { name: /Assemblies/ }));
    expect(screen.getByRole('tab', { name: /Assemblies/ })).toHaveAttribute('aria-selected', 'true');
  });
});
