import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MyMembers } from '../components/leader/MyMembers';

// Phase 3K — MyMembers roster visibility distinguishes an exact-scope row
// from a descendant-only row for Geography scopes; this file tests that
// distinction, which is unaffected by Follow-Up retirement. Geography
// Retirement Step 5A then retired "Start Follow-Up" for Geography rows
// entirely (exact-scope and descendant alike) — see
// MyMembersAction.test.tsx for that. Same URL-dispatching fetch mock
// pattern as MyMembersAction.test.tsx.
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

describe('MyMembers — Phase 3K Geography descendant visibility', () => {
  it('Geography Retirement Step 5A: neither an exact-scope row nor a descendant-only row offers Start Follow-Up any more — both show the same explanatory label', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'region-1', name: 'My Region', type: 'REGION' } }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'region-1',
          items: [
            { personId: 'p1', name: 'Exact Scope Person', geographicAssignedAt: '2026-01-15T00:00:00Z', personGeographyId: 'region-1' },
            { personId: 'p2', name: 'Descendant Person', geographicAssignedAt: '2026-02-20T00:00:00Z', personGeographyId: 'village-1' },
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Exact Scope Person')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const exactRow = rows.find((r) => r.textContent?.includes('Exact Scope Person'))!;
    const descendantRow = rows.find((r) => r.textContent?.includes('Descendant Person'))!;

    expect(exactRow.textContent).not.toContain('Start Follow-Up');
    expect(descendantRow.textContent).not.toContain('Start Follow-Up');
    expect(exactRow.textContent).toContain('Follow-up is no longer available by Geography.');
    expect(descendantRow.textContent).toContain('Follow-up is no longer available by Geography.');
  });

  it('shows the descendant-inclusion note for a Geography scope', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'region-1', name: 'My Region', type: 'REGION' } }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: { scopeType: 'GEOGRAPHY', scopeId: 'region-1', items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('This list includes people in this area and its subordinate localities.')).toBeInTheDocument();
    });
  });

  it('does not show the descendant-inclusion note for a Community scope', async () => {
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
          items: [{ personId: 'p1', name: 'Community Person', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Community Person')).toBeInTheDocument();
    });
    expect(screen.queryByText('This list includes people in this area and its subordinate localities.')).not.toBeInTheDocument();
    // Community rows remain exact-scope only — Start Follow-Up is always offered.
    expect(screen.getByText('Start Follow-Up')).toBeInTheDocument();
  });

});
