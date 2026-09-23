import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyMembers } from '../components/leader/MyMembers';

// Phase 3L — Roster → Propose for Leadership. Same URL-dispatching fetch
// mock pattern as MyMembersAction.test.tsx / MyMembersGeographyDescendant.test.tsx.
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

const GEOGRAPHY_ROLE = {
  items: [{ id: 'r1', community: null, geography: { id: 'region-1', name: 'My Region', type: 'REGION' } }],
};
const COMMUNITY_ROLE = {
  items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('MyMembers — Phase 3L Propose for Leadership', () => {
  it('offers Propose for Leadership for a Geography row', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: GEOGRAPHY_ROLE },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'region-1',
          items: [{ personId: 'p1', name: 'Candidate Person', geographicAssignedAt: '2026-01-15T00:00:00Z', personGeographyId: 'village-1' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getByText('Propose for Leadership')).toBeInTheDocument();
  });

  it('does not offer Propose for Leadership for a Community row', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: COMMUNITY_ROLE },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Community Person', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Community Person')).toBeInTheDocument();
    });
    expect(screen.queryByText('Propose for Leadership')).not.toBeInTheDocument();
  });

  it('submits the correct personId, geographyId (the selected scope), and optional note', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: GEOGRAPHY_ROLE },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'region-1',
          items: [{ personId: 'p1', name: 'Candidate Person', geographicAssignedAt: '2026-01-15T00:00:00Z', personGeographyId: 'village-1' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/leadership-proposals': { status: 201, body: { id: 'proposal-1', status: 'PROPOSED' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Propose for Leadership'));
    fireEvent.change(screen.getByPlaceholderText('Optional note for Central Authority'), { target: { value: 'Faithful servant.' } });
    fireEvent.click(screen.getByText('Submit Proposal'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.url === '/api/leader/leadership-proposals' && c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toEqual({ proposedPersonId: 'p1', geographyId: 'region-1', note: 'Faithful servant.' });
    });
  });

  it('shows success feedback after a successful proposal', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: GEOGRAPHY_ROLE },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'region-1',
          items: [{ personId: 'p1', name: 'Candidate Person', geographicAssignedAt: '2026-01-15T00:00:00Z', personGeographyId: 'village-1' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/leadership-proposals': { status: 201, body: { id: 'proposal-1', status: 'PROPOSED' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Propose for Leadership'));
    fireEvent.click(screen.getByText('Submit Proposal'));

    await waitFor(() => {
      expect(screen.getByText('Proposal submitted for Central Authority review.')).toBeInTheDocument();
    });
  });

  it('surfaces a duplicate/conflict error from the server', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: GEOGRAPHY_ROLE },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'region-1',
          items: [{ personId: 'p1', name: 'Candidate Person', geographicAssignedAt: '2026-01-15T00:00:00Z', personGeographyId: 'village-1' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/leadership-proposals': { status: 409, body: { error: 'A pending proposal for this person and geography already exists.' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Propose for Leadership'));
    fireEvent.click(screen.getByText('Submit Proposal'));

    await waitFor(() => {
      expect(screen.getByText('A pending proposal for this person and geography already exists.')).toBeInTheDocument();
    });
  });
});
