import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { PeopleTab } from '../components/admin/PeopleTab';
import i18n from '../i18n';

// Member Reassignment — Admin's "Move" action within PeopleTab.tsx's
// existing Community Memberships section. Same URL-dispatching fetch mock
// pattern established across prior client tests (PeopleTabResourceAccess
// .test.tsx, PrivateMessages.test.tsx).
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 200, body: { items: [] } };
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
  i18n.changeLanguage('en');
});

const PERSON_LIST = {
  items: [{ id: 'p1', name: 'Grace Doe', whatsappNumber: '+237600000000', email: null, geographicAssignment: null, _count: { communityMemberships: 1, registrations: 0 } }],
  pagination: { totalPages: 1 },
};

function personDetail(memberships: any[]) {
  return {
    id: 'p1',
    name: 'Grace Doe',
    whatsappNumber: '+237600000000',
    email: null,
    preferredLanguage: 'en',
    geographicAssignment: null,
    communityMemberships: memberships,
    registrations: [],
    users: [],
  };
}

const ONE_MEMBERSHIP = [{ id: 'm1', status: 'ACTIVE', joinedAt: '2026-01-01T00:00:00Z', community: { id: 'c1', name: 'Community A' } }];

function baseResponses(extra: Record<string, { status: number; body: unknown }> = {}) {
  return {
    '/api/admin/people/p1/training-progress': { status: 200, body: { totalEligible: 0, completedCount: 0, items: [] } },
    '/api/admin/people/p1/resource-access': { status: 200, body: { items: [] } },
    '/api/admin/people/p1': { status: 200, body: personDetail(ONE_MEMBERSHIP) },
    '/api/admin/people': { status: 200, body: PERSON_LIST },
    ...extra,
  };
}

async function openPersonAndStartMove() {
  render(<PeopleTab includeTestData={false} />);
  fireEvent.click(await screen.findByText('View'));
  await waitFor(() => expect(screen.getByText(/Community A/)).toBeInTheDocument());
  fireEvent.click(screen.getByText('Move'));
}

function destinationPicker() {
  // Two SearchPickers share the same placeholder (the "add membership" one
  // at the bottom of the card and the move panel's own) — the move panel's
  // copy is found via its own "Destination Community" label, always present
  // in the same wrapping container as its SearchPicker.
  const container = screen.getByText('Destination Community').closest('div')!;
  return { input: within(container).getByPlaceholderText('Search communities by name'), container };
}

describe('PeopleTab — Member Reassignment (Move)', () => {
  it('renders a Move action for an ACTIVE membership, showing the current Community', async () => {
    mockFetchByUrl(baseResponses());
    await openPersonAndStartMove();

    expect(screen.getByText('Current Community: Community A')).toBeInTheDocument();
    expect(screen.getByText('Destination Community')).toBeInTheDocument();
  });

  it('does not render a Move action for an INACTIVE membership', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/people/p1': {
          status: 200,
          body: personDetail([{ id: 'm1', status: 'INACTIVE', joinedAt: '2026-01-01T00:00:00Z', community: { id: 'c1', name: 'Community A' } }]),
        },
      }),
    );
    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('View'));
    await waitFor(() => expect(screen.getByText(/Community A/)).toBeInTheDocument());

    expect(screen.queryByText('Move')).not.toBeInTheDocument();
  });

  it('allows selecting a destination Community other than the current one', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/communities?search=Dest': { status: 200, body: { items: [{ id: 'c2', name: 'Community B' }] } },
      }),
    );
    await openPersonAndStartMove();

    const { input, container } = destinationPicker();
    fireEvent.change(input, { target: { value: 'Dest' } });
    fireEvent.click(within(container).getByText('Search'));

    await waitFor(() => expect(within(container).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'c2' } });
    fireEvent.click(within(container).getByText('Select Destination'));

    expect(screen.getByText('Move to Community B?')).toBeInTheDocument();
  });

  it('rejects the current Community as its own destination, without calling the server', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/communities?search=Same': { status: 200, body: { items: [{ id: 'c1', name: 'Community A' }] } },
      }),
    );
    await openPersonAndStartMove();

    const { input, container } = destinationPicker();
    fireEvent.change(input, { target: { value: 'Same' } });
    fireEvent.click(within(container).getByText('Search'));

    await waitFor(() => expect(within(container).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'c1' } });
    fireEvent.click(within(container).getByText('Select Destination'));

    expect(screen.getByText('Same Community')).toBeInTheDocument();
    expect(screen.queryByText('Confirm Move')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/community-memberships/move'))).toBe(false);
  });

  it('shows a loading state while the move is in progress and prevents double submission', async () => {
    let resolveMove: (v: any) => void;
    mockFetchByUrl(
      baseResponses({
        '/api/admin/communities?search=Dest': { status: 200, body: { items: [{ id: 'c2', name: 'Community B' }] } },
      }),
    );
    await openPersonAndStartMove();
    const { input, container } = destinationPicker();
    fireEvent.change(input, { target: { value: 'Dest' } });
    fireEvent.click(within(container).getByText('Search'));
    await waitFor(() => expect(within(container).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'c2' } });
    fireEvent.click(within(container).getByText('Select Destination'));

    // Replace the mock with one that never resolves, to observe the pending
    // "Moving…" state deterministically before completing it ourselves.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveMove = resolve;
          }),
      ),
    );

    fireEvent.click(screen.getByText('Confirm Move'));
    await waitFor(() => expect(screen.getByText('Moving…')).toBeInTheDocument());
    expect(screen.getByText('Moving…')).toBeDisabled();

    resolveMove!({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 'm1', status: 'ACTIVE', joinedAt: '2026-01-03T00:00:00Z', community: { id: 'c2', name: 'Community B' } }),
    });
  });

  it('displays success feedback and refreshes the membership display after a successful move', async () => {
    let callCount = 0;
    mockFetchByUrl(
      baseResponses({
        '/api/admin/communities?search=Dest': { status: 200, body: { items: [{ id: 'c2', name: 'Community B' }] } },
      }),
    );
    // After the move succeeds, the detail reload should show the person now
    // in Community B instead of Community A.
    const originalFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('/community-memberships/move')) {
          calls.push({ url, method: 'POST', body: JSON.parse(init!.body as string) });
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'm1', status: 'ACTIVE', joinedAt: '2026-01-03T00:00:00Z', community: { id: 'c2', name: 'Community B' } }),
          });
        }
        if (url.includes('/api/admin/people/p1') && !url.includes('training-progress') && !url.includes('resource-access')) {
          callCount += 1;
          const body = callCount === 1 ? personDetail(ONE_MEMBERSHIP) : personDetail([{ id: 'm1', status: 'ACTIVE', joinedAt: '2026-01-03T00:00:00Z', community: { id: 'c2', name: 'Community B' } }]);
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
        }
        return (originalFetch as any)(url, init);
      }),
    );

    await openPersonAndStartMove();
    const { input, container } = destinationPicker();
    fireEvent.change(input, { target: { value: 'Dest' } });
    fireEvent.click(within(container).getByText('Search'));
    await waitFor(() => expect(within(container).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'c2' } });
    fireEvent.click(within(container).getByText('Select Destination'));
    fireEvent.click(screen.getByText('Confirm Move'));

    await waitFor(() => expect(screen.getByText('Member moved successfully.')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Community B/)).toBeInTheDocument());
  });

  it('displays a generic error when the move fails on the network', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/communities?search=Dest': { status: 200, body: { items: [{ id: 'c2', name: 'Community B' }] } },
      }),
    );
    await openPersonAndStartMove();
    const { input, container } = destinationPicker();
    fireEvent.change(input, { target: { value: 'Dest' } });
    fireEvent.click(within(container).getByText('Search'));
    await waitFor(() => expect(within(container).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'c2' } });
    fireEvent.click(within(container).getByText('Select Destination'));

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    fireEvent.click(screen.getByText('Confirm Move'));

    await waitFor(() => expect(screen.getByText('Unable to move member.')).toBeInTheDocument());
  });

  it('handles a conflict response (already in target) with its own localized message', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/communities?search=Dest': { status: 200, body: { items: [{ id: 'c2', name: 'Community B' }] } },
      }),
    );
    await openPersonAndStartMove();
    const { input, container } = destinationPicker();
    fireEvent.change(input, { target: { value: 'Dest' } });
    fireEvent.click(within(container).getByText('Search'));
    await waitFor(() => expect(within(container).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'c2' } });
    fireEvent.click(within(container).getByText('Select Destination'));

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'This person already has an active membership in the destination Community.', code: 'ALREADY_IN_TARGET' }),
        }),
      ),
    );
    fireEvent.click(screen.getByText('Confirm Move'));

    await waitFor(() => expect(screen.getByText('Member already belongs to the destination Community.')).toBeInTheDocument());
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl(baseResponses());
    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('Voir'));
    await waitFor(() => expect(screen.getByText(/Community A/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Déplacer'));

    expect(screen.getByText('Communauté actuelle : Community A')).toBeInTheDocument();
    expect(screen.getByText('Communauté de destination')).toBeInTheDocument();
  });

  it('leaves existing membership add/remove functionality intact', async () => {
    mockFetchByUrl(baseResponses());
    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('View'));
    await waitFor(() => expect(screen.getByText(/Community A/)).toBeInTheDocument());

    expect(screen.getByText('Deactivate')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Deactivate'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/api/admin/community-memberships/m1'));
      expect(patchCall).toBeTruthy();
      expect((patchCall!.body as any).status).toBe('INACTIVE');
    });
  });
});
