import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyMembers } from '../components/leader/MyMembers';

// Phase 3H — mirrors the fetch-mocking pattern established in
// TrainingProgress.test.tsx. MyMembers makes two sequential requests
// (role-assignments, then roster), so this mock dispatches a response per
// URL rather than a single fixed one.
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

describe('MyMembers', () => {
  it('renders nothing for a Leader with no active scoped roles', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: { items: [] } },
    });

    const { container } = render(<MyMembers />);

    await waitFor(() => {
      expect(container.innerHTML).toBe('');
    });
  });

  it('shows the Community roster with the membership join date', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Joined')).toBeInTheDocument();
    expect(screen.queryByText('Assigned')).not.toBeInTheDocument();
  });

  it('shows the Geography roster with the assignment date', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'g1', name: 'My Region', type: 'REGION' } }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'g1',
          items: [{ personId: 'p2', name: 'John Smith', geographicAssignedAt: '2026-02-20T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Assigned')).toBeInTheDocument();
    expect(screen.queryByText('Joined')).not.toBeInTheDocument();
  });

  it('keeps multiple scopes separated via a scope selector, not aggregated', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: {
          items: [
            { id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null },
            { id: 'r2', community: null, geography: { id: 'g1', name: 'My Region', type: 'REGION' } },
          ],
        },
      },
      'scopeType=COMMUNITY&scopeId=c1': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      'scopeType=GEOGRAPHY&scopeId=g1': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'g1',
          items: [{ personId: 'p2', name: 'John Smith', geographicAssignedAt: '2026-02-20T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'GEOGRAPHY:g1' } });

    await waitFor(() => {
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('shows the empty-roster state when an authorized scope has no members', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('No active members in this scope yet.')).toBeInTheDocument();
    });
  });

  it('shows the load-failed error state when the roster request fails', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': { status: 500, body: { error: 'boom' } },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load your roster.')).toBeInTheDocument();
    });
  });
});
