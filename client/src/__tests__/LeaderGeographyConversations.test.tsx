import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LeaderGeographyConversations } from '../components/leader/LeaderGeographyConversations';

// Phase 3M.6 — same URL-dispatching fetch mock pattern established for
// LeaderCommunityConversations.test.tsx (Phase 3M.1).
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

describe('LeaderGeographyConversations', () => {
  it('renders one conversation panel per Geography-scoped active RoleAssignment', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: {
          items: [
            { id: 'r1', community: null, geography: { id: 'g1', name: 'Leader Region One', type: 'REGION' } },
            { id: 'r2', community: { id: 'c1', name: 'Some Community' }, geography: null },
          ],
        },
      },
      '/api/geographies/g1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeaderGeographyConversations />);

    await waitFor(() => {
      expect(screen.getByText('Leader Region One — Conversation')).toBeInTheDocument();
    });
    // Community-scoped roles never get a Geography conversation panel.
    expect(screen.queryByText('Some Community — Conversation')).not.toBeInTheDocument();
  });

  it('renders nothing when the Leader holds no Geography-scoped role', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'Some Community' }, geography: null }] },
      },
    });

    const { container } = render(<LeaderGeographyConversations />);

    await waitFor(() => {
      expect(container.querySelectorAll('.card').length).toBe(0);
    });
  });
});
