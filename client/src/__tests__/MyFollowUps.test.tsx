import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyFollowUps } from '../components/member/MyFollowUps';

// Phase 3M.2 — Member's own Follow-Up list + conversation. Same
// URL-dispatching fetch mock pattern established across prior phases.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
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

describe('MyFollowUps (Member)', () => {
  it('renders nothing when the Member has no Follow-Up relationships', async () => {
    mockFetchByUrl({
      '/api/member/me/follow-ups': { status: 200, body: { items: [] } },
    });

    const { container } = render(<MyFollowUps />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('lists a Follow-Up relationship with the follower\'s name and status', async () => {
    mockFetchByUrl({
      '/api/member/me/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'ACTIVE', assignedAt: '2026-01-01T00:00:00Z', closedAt: null, follower: { id: 'l1', name: 'Mary Ngu' } }] },
      },
    });

    render(<MyFollowUps />);

    await waitFor(() => {
      expect(screen.getByText('Mary Ngu')).toBeInTheDocument();
    });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Open Conversation')).toBeInTheDocument();
  });

  it('opens the conversation for the selected Follow-Up', async () => {
    mockFetchByUrl({
      '/api/member/me/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'ACTIVE', assignedAt: '2026-01-01T00:00:00Z', closedAt: null, follower: { id: 'l1', name: 'Mary Ngu' } }] },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'ACTIVE' } },
      '/api/follow-ups/f1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Mary Ngu', body: 'How are you?', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<MyFollowUps />);

    fireEvent.click(await screen.findByText('Open Conversation'));

    await waitFor(() => {
      expect(screen.getByText('How are you?')).toBeInTheDocument();
    });
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('returns to the list when Back is clicked', async () => {
    mockFetchByUrl({
      '/api/member/me/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'CLOSED', assignedAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-05T00:00:00Z', follower: { id: 'l1', name: 'Mary Ngu' } }] },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'CLOSED' } },
      '/api/follow-ups/f1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<MyFollowUps />);

    fireEvent.click(await screen.findByText('Open Conversation'));
    await waitFor(() => {
      expect(screen.getByText('This follow-up has been closed. The conversation is read-only.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Back'));

    await waitFor(() => {
      expect(screen.getByText('Open Conversation')).toBeInTheDocument();
    });
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('shows an error state when discovery fails', async () => {
    mockFetchByUrl({
      '/api/member/me/follow-ups': { status: 500, body: { error: 'boom' } },
    });

    render(<MyFollowUps />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load your follow-ups.')).toBeInTheDocument();
    });
  });
});
