import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MyFollowUp } from '../components/leader/MyFollowUp';

// Phase 3I — same URL-dispatching fetch mock pattern established in
// TrainingProgress.test.tsx / MyMembers.test.tsx. MyFollowUp now makes three
// requests when the Leader has an active role (role-assignments, follow-ups,
// follow-ups/attention), so responses are dispatched by URL rather than a
// single fixed mock. The attention key is listed before the base follow-ups
// key so its more specific match wins first.
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

const ONE_ROLE = { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] };
const NO_FOLLOWUPS = { items: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MyFollowUp — Phase 3I Needs Attention section', () => {
  it('displays an Emergency item correctly', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': {
        status: 200,
        body: {
          items: [
            {
              followUpAssignmentId: 'a1',
              personId: 'p1',
              name: 'Jane Doe',
              reason: 'EMERGENCY',
              lastContactedAt: '2026-09-01T00:00:00Z',
              nextFollowUpDate: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Emergency')).toBeInTheDocument();
  });

  it('displays a Needs Attention item correctly', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': {
        status: 200,
        body: {
          items: [
            {
              followUpAssignmentId: 'a2',
              personId: 'p2',
              name: 'John Smith',
              reason: 'NEEDS_ATTENTION',
              lastContactedAt: '2026-09-02T00:00:00Z',
              nextFollowUpDate: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('displays an Overdue item with its next follow-up date', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': {
        status: 200,
        body: {
          items: [
            {
              followUpAssignmentId: 'a3',
              personId: 'p3',
              name: 'Overdue Person',
              reason: 'OVERDUE',
              lastContactedAt: '2026-08-01T00:00:00Z',
              nextFollowUpDate: '2026-08-15T00:00:00Z',
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Overdue Person')).toBeInTheDocument();
    });
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('displays a Not Yet Contacted item correctly', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': {
        status: 200,
        body: {
          items: [
            {
              followUpAssignmentId: 'a4',
              personId: 'p4',
              name: 'New Person',
              reason: 'NOT_YET_CONTACTED',
              lastContactedAt: null,
              nextFollowUpDate: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('New Person')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Not yet contacted').length).toBeGreaterThan(0);
  });

  it('shows the empty state when nothing needs attention', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': {
        status: 200,
        body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
      },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
    });
  });

  it('shows an error state when the attention request fails', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': { status: 500, body: { error: 'boom' } },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load your attention list.')).toBeInTheDocument();
    });
  });

  it('leaves existing My Follow-Up functionality intact (list of follow-ups still renders)', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': {
        status: 200,
        body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
      },
      '/api/leader/follow-ups': {
        status: 200,
        body: {
          items: [
            {
              id: 'f1',
              status: 'ACTIVE',
              contextType: 'COMMUNITY',
              contextId: 'c1',
              followedPerson: { id: 'p5', name: 'Existing Followed Person' },
              contacts: [],
            },
          ],
        },
      },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Existing Followed Person')).toBeInTheDocument();
    });
    expect(screen.getByText('+ New Follow-Up')).toBeInTheDocument();
  });
});
