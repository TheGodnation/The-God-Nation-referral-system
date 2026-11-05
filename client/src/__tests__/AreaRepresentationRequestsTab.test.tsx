import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AreaRepresentationRequestsTab } from '../components/admin/AreaRepresentationRequestsTab';

const calls: { url: string; method: string; body: unknown }[] = [];

const REQUEST = {
  id: 'req-1',
  note: 'I already lead our cell group here.',
  status: 'PENDING',
  createdAt: '2026-01-01T00:00:00Z',
  decidedAt: null,
  decisionNote: null,
  person: { id: 'p1', name: 'Requester One' },
  area: { id: 'area-1', name: 'Bepanda', level: 'QUARTER' },
};

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
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
  calls.length = 0;
});

describe('AreaRepresentationRequestsTab (Admin)', () => {
  it('lists pending requests with person and area', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests': { status: 200, body: { items: [REQUEST], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    expect(await screen.findByText('Requester One')).toBeInTheDocument();
    expect(screen.getByText('Bepanda')).toBeInTheDocument();
    expect(screen.getByText(/I already lead our cell group here\./)).toBeInTheDocument();
    // What it is for: the level of the place, so a region or a division is never mistaken for a quarter.
    expect(screen.getByText('Quarter')).toBeInTheDocument();
  });

  it('approving calls the approve endpoint and reloads', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests/req-1/approve': { status: 200, body: { ...REQUEST, status: 'APPROVED', areaLeadershipAssignmentId: 'assign-1' } },
      '/api/admin/area-representation-requests': { status: 200, body: { items: [REQUEST], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/area-representation-requests/req-1/approve'))).toBe(true);
    });
  });

  it('declining calls the decline endpoint', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests/req-1/decline': { status: 200, body: { ...REQUEST, status: 'DECLINED' } },
      '/api/admin/area-representation-requests': { status: 200, body: { items: [REQUEST], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    fireEvent.click(await screen.findByText('Decline'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/area-representation-requests/req-1/decline'))).toBe(true);
    });
  });

  it('shows an empty state when there are no requests', async () => {
    mockFetchByUrl({ '/api/admin/area-representation-requests': { status: 200, body: { items: [], pagination: { totalPages: 1 } } } });
    render(<AreaRepresentationRequestsTab />);
    expect(await screen.findByText('No representation requests found.')).toBeInTheDocument();
  });
  it('shows the level asked for when the place is typed in: a region, a division or a subdivision', async () => {
    const typed = (over: Record<string, unknown>) => ({ ...REQUEST, area: null, typedCountry: 'Cameroon', typedRegion: null, typedDivision: null, typedSubdivision: null, typedQuarter: null, ...over });
    mockFetchByUrl({
      '/api/admin/area-representation-requests': {
        status: 200,
        body: {
          items: [
            typed({ id: 'a', person: { id: 'p1', name: 'Wants A Region' }, typedRegion: 'Littoral' }),
            typed({ id: 'b', person: { id: 'p2', name: 'Wants A Division' }, typedRegion: 'South-West', typedDivision: 'Fako' }),
            typed({ id: 'c', person: { id: 'p3', name: 'Wants A Subdivision' }, typedRegion: 'South-West', typedDivision: 'Fako', typedSubdivision: 'Buea' }),
          ],
          pagination: { totalPages: 1 },
        },
      },
    });
    render(<AreaRepresentationRequestsTab />);
    await screen.findByText('Wants A Region');
    const cards = screen.getAllByTestId('area-request');
    expect(cards[0]).toHaveTextContent('Region');
    expect(cards[0]).toHaveTextContent('Littoral, Cameroon');
    expect(cards[1]).toHaveTextContent('Division');
    expect(cards[1]).toHaveTextContent('Fako, South-West, Cameroon');
    expect(cards[2]).toHaveTextContent('Subdivision');
    // Each says the place is added when approved.
    expect(cards[0]).toHaveTextContent('It will be added when you approve');
  });

  it('a declined request can be approved after all, and an approved one turned down', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests/req-1/approve': { status: 200, body: { ...REQUEST, status: 'APPROVED' } },
      '/api/admin/area-representation-requests/req-1/decline': { status: 200, body: { ...REQUEST, status: 'DECLINED' } },
      '/api/admin/area-representation-requests': { status: 200, body: { items: [{ ...REQUEST, status: 'DECLINED', decidedAt: '2026-01-02T00:00:00Z', decisionNote: 'Not yet.' }], pagination: { totalPages: 1 } } },
    });
    const { unmount } = render(<AreaRepresentationRequestsTab />);
    // The decision is shown, with a way to change it; nothing can be pressed by accident.
    expect(await screen.findByText(/Declined on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve instead' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change decision' }));
    fireEvent.change(screen.getByLabelText('Optional decision note'), { target: { value: 'On reflection, yes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve instead' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/req-1/approve'))).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/req-1/approve'))!.body).toMatchObject({ decisionNote: 'On reflection, yes.' });
    unmount();

    calls.length = 0;
    mockFetchByUrl({
      '/api/admin/area-representation-requests/req-1/decline': { status: 200, body: { ...REQUEST, status: 'DECLINED' } },
      '/api/admin/area-representation-requests': { status: 200, body: { items: [{ ...REQUEST, status: 'APPROVED', decidedAt: '2026-01-02T00:00:00Z' }], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change decision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn down' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/req-1/decline'))).toBe(true));
  });
});
