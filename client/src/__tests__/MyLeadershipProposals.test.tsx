import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyLeadershipProposals } from '../components/leader/MyLeadershipProposals';

// Phase 3L — Leader's own proposal list. Same URL-dispatching fetch mock
// pattern as MyMembersProposeForLeadership.test.tsx.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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
  calls.length = 0;
});

describe('MyLeadershipProposals', () => {
  it('renders nothing when the Leader has never made a proposal', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-proposals': { status: 200, body: { items: [] } },
    });

    const { container } = render(<MyLeadershipProposals />);

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-proposals': { status: 200, body: { items: [] } },
    });

    const { container } = render(<MyLeadershipProposals />);
    expect(container).toBeEmptyDOMElement();

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('shows a PROPOSED proposal with a Withdraw action', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-proposals': {
        status: 200,
        body: {
          items: [
            {
              id: 'p1',
              status: 'PROPOSED',
              note: 'Faithful servant.',
              createdAt: '2026-01-10T00:00:00Z',
              decidedAt: null,
              decisionNote: null,
              proposedPerson: { id: 'person-1', name: 'Candidate Person' },
              geography: { id: 'region-1', name: 'My Region', type: 'REGION' },
            },
          ],
        },
      },
    });

    render(<MyLeadershipProposals />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getByText('My Region')).toBeInTheDocument();
    expect(screen.getByText('Pending Review')).toBeInTheDocument();
    expect(screen.getByText('Withdraw')).toBeInTheDocument();
  });

  it('does not show a Withdraw action for a decided proposal, and shows the decision note', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-proposals': {
        status: 200,
        body: {
          items: [
            {
              id: 'p2',
              status: 'APPROVED',
              note: null,
              createdAt: '2026-01-10T00:00:00Z',
              decidedAt: '2026-01-12T00:00:00Z',
              decisionNote: 'Confirmed with regional council.',
              proposedPerson: { id: 'person-2', name: 'Approved Candidate' },
              geography: { id: 'region-1', name: 'My Region', type: 'REGION' },
            },
          ],
        },
      },
    });

    render(<MyLeadershipProposals />);

    await waitFor(() => {
      expect(screen.getByText('Approved Candidate')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Confirmed with regional council.')).toBeInTheDocument();
    expect(screen.queryByText('Withdraw')).not.toBeInTheDocument();
  });

  it('withdraws a PROPOSED proposal and refreshes the list', async () => {
    let withdrawn = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/withdraw')) {
          withdrawn = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'p1', status: 'WITHDRAWN' }),
          });
        }
        const items = withdrawn
          ? []
          : [
              {
                id: 'p1',
                status: 'PROPOSED',
                note: null,
                createdAt: '2026-01-10T00:00:00Z',
                decidedAt: null,
                decisionNote: null,
                proposedPerson: { id: 'person-1', name: 'Candidate Person' },
                geography: { id: 'region-1', name: 'My Region', type: 'REGION' },
              },
            ];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items }),
        });
      }),
    );

    render(<MyLeadershipProposals />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Withdraw'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.url.includes('/api/leader/leadership-proposals/p1/withdraw'));
      expect(postCall).toBeTruthy();
      expect(postCall!.method).toBe('POST');
    });

    await waitFor(() => {
      expect(screen.queryByText('Candidate Person')).not.toBeInTheDocument();
    });
  });

  it('shows an error message when loading fails', async () => {
    mockFetchByUrl({
      '/api/leader/leadership-proposals': { status: 500, body: { error: 'boom' } },
    });

    render(<MyLeadershipProposals />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load your proposals.')).toBeInTheDocument();
    });
  });
});
