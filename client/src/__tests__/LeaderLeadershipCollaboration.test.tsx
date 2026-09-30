import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LeaderLeadershipCollaboration } from '../components/leader/LeaderLeadershipCollaboration';

// Phase 2B — same URL-dispatching fetch mock pattern established for
// LeaderCommunityConversations.test.tsx.
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

describe('LeaderLeadershipCollaboration', () => {
  it('renders one collaboration panel per eligible generation', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-collaboration': { status: 200, body: { items: [{ generation: 1, unreadCount: 0 }] } },
      '/leadership-collaboration/1/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeaderLeadershipCollaboration />);

    await waitFor(() => {
      expect(screen.getByText('Generation 1 — Leadership Collaboration')).toBeInTheDocument();
    });
    expect(screen.getByText('Leadership Collaboration')).toBeInTheDocument();
  });

  it('renders a panel for each of multiple eligible generations', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-collaboration': {
        status: 200,
        body: { items: [{ generation: 1, unreadCount: 0 }, { generation: 2, unreadCount: 0 }] },
      },
      '/leadership-collaboration/1/messages': { status: 200, body: { items: [], hasMore: false } },
      '/leadership-collaboration/2/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeaderLeadershipCollaboration />);

    await waitFor(() => {
      expect(screen.getByText('Generation 1 — Leadership Collaboration')).toBeInTheDocument();
    });
    expect(screen.getByText('Generation 2 — Leadership Collaboration')).toBeInTheDocument();
  });

  it('shows a visible empty state when the Leader has no eligible generations', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-collaboration': { status: 200, body: { items: [] } },
    });

    render(<LeaderLeadershipCollaboration />);

    await waitFor(() => {
      expect(screen.getByText('You are not currently eligible for any generation collaboration.')).toBeInTheDocument();
    });
  });

  it('shows an error state when the eligible-generation list fails to load', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-collaboration': { status: 500, body: { error: 'boom' } },
    });

    render(<LeaderLeadershipCollaboration />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load collaboration.')).toBeInTheDocument();
    });
  });
});
