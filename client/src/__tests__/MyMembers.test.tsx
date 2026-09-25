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

  it('shows the add-member form for a Community scope, and hides it for a Geography scope', async () => {
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
        body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
      },
      'scopeType=GEOGRAPHY&scopeId=g1': {
        status: 200,
        body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Existing member's WhatsApp number")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GEOGRAPHY:g1' } });

    await waitFor(() => {
      expect(screen.getByText('No active members in this scope yet.')).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Existing member's WhatsApp number")).not.toBeInTheDocument();
  });

  it('adding an existing member by WhatsApp number succeeds and refreshes the roster', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    let added = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/api/leader/role-assignments')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] }),
          });
        }
        if (method === 'POST' && url.includes('/api/leader/communities/c1/members')) {
          added = true;
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'mem1', status: 'ACTIVE', person: { id: 'p9', name: 'New Person' } }),
          });
        }
        const items = added ? [{ personId: 'p9', name: 'New Person', membershipJoinedAt: '2026-03-01T00:00:00Z' }] : [];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } }),
        });
      }),
    );

    render(<MyMembers />);
    const input = await screen.findByPlaceholderText("Existing member's WhatsApp number");
    fireEvent.change(input, { target: { value: '+237698765432' } });
    fireEvent.click(screen.getByText('Add to Community'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toEqual({ whatsappNumber: '+237698765432' });
    });
    await waitFor(() => {
      expect(screen.getByText('Member added.')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('New Person')).toBeInTheDocument();
    });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('surfaces an error when adding a member fails, without clearing the input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url.includes('/api/leader/role-assignments')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] }),
          });
        }
        if (method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 404,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'No person was found with that WhatsApp number.' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
        });
      }),
    );

    render(<MyMembers />);
    const input = await screen.findByPlaceholderText("Existing member's WhatsApp number");
    fireEvent.change(input, { target: { value: '+237600000000' } });
    fireEvent.click(screen.getByText('Add to Community'));

    await waitFor(() => {
      expect(screen.getByText('No person was found with that WhatsApp number.')).toBeInTheDocument();
    });
    expect((input as HTMLInputElement).value).toBe('+237600000000');
  });

  it('shows a Remove action for Community rows, and removing a member refreshes the roster', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const calls: { url: string; method: string; body: unknown }[] = [];
    let removed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/api/leader/role-assignments')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] }),
          });
        }
        if (method === 'PATCH' && url.includes('/api/leader/communities/c1/members/p1')) {
          removed = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'mem1', status: 'INACTIVE' }),
          });
        }
        const items = removed ? [] : [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } }),
        });
      }),
    );

    render(<MyMembers />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall!.body).toEqual({ status: 'INACTIVE' });
    });
    await waitFor(() => {
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    });
  });

  it('does not remove a member when the confirmation dialog is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Remove'));

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('hides the Remove action for Geography rows', async () => {
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
          items: [{ personId: 'p2', name: 'John Smith', geographicAssignedAt: '2026-02-20T00:00:00Z', personGeographyId: 'g1' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);
    await screen.findByText('John Smith');
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });
});
