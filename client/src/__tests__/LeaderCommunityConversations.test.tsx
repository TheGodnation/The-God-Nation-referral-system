import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LeaderCommunityConversations } from '../components/leader/LeaderCommunityConversations';

// Phase 3M.1 — same URL-dispatching fetch mock pattern established across
// prior phases' Leader client tests.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const match = Object.keys(responses).find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LeaderCommunityConversations', () => {
  it('renders one conversation panel per Community-scoped active RoleAssignment', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: {
          items: [
            { id: 'r1', community: { id: 'c1', name: 'Leader Community One' }, geography: null },
            { id: 'r2', community: null, geography: { id: 'g1', name: 'Some Region', type: 'REGION' } },
          ],
        },
      },
      '/api/communities/c1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeaderCommunityConversations />);

    await waitFor(() => {
      expect(screen.getByText('Leader Community One — Conversation')).toBeInTheDocument();
    });
    // Geography-scoped roles never get a conversation panel in Phase 3M.1.
    expect(screen.queryByText('Some Region — Conversation')).not.toBeInTheDocument();
  });

  it('renders nothing when the Leader holds no Community-scoped role', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'g1', name: 'Some Region', type: 'REGION' } }] },
      },
    });

    const { container } = render(<LeaderCommunityConversations />);

    await waitFor(() => {
      expect(container.querySelectorAll('.card').length).toBe(0);
    });
  });
});
