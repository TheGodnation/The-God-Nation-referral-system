import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GeographicDirectory } from '../components/member/GeographicDirectory';

const calls: { url: string; method: string; body: unknown }[] = [];

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

function renderWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/member/leadership']}>
      <Routes>
        <Route path="/member/leadership" element={<GeographicDirectory />} />
        <Route path="/member/people/:personId" element={<div>Person Profile Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const BASE_ROUTES = {
  '/geographic-areas/countries': { status: 200, body: { items: [{ id: 'c1', name: 'Cameroon', country: 'Cameroon' }] } },
  '/area-representation-requests/mine': { status: 200, body: { items: [] } },
};

describe('GeographicDirectory (Member)', () => {
  it('renders nothing when no country has been set up yet', async () => {
    mockFetchByUrl({
      '/geographic-areas/countries': { status: 200, body: { items: [] } },
      '/area-representation-requests/mine': { status: 200, body: { items: [] } },
    });
    const { container } = renderWithRoutes();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a leader card with photo, name, title, and area path immediately — no profile click needed', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: { items: [{ id: 'area-1', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Grace Leader', photoUrl: null }] }] },
      },
    });
    renderWithRoutes();
    expect(await screen.findByText('Grace Leader')).toBeInTheDocument();
    expect(screen.getByText('Divisional Leader')).toBeInTheDocument();
    expect(screen.getByText('Wouri, Littoral, Cameroon')).toBeInTheDocument();
  });

  it('clearly lists areas with no assigned representative, separately from represented ones', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: {
          items: [
            { id: 'area-1', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Grace Leader', photoUrl: null }] },
            { id: 'area-2', name: 'Sanaga', level: 'DIVISION', title: 'Divisional Leader', path: 'Sanaga, Littoral, Cameroon', leaders: [] },
          ],
        },
      },
    });
    renderWithRoutes();
    expect(await screen.findByText('Grace Leader')).toBeInTheDocument();
    expect(screen.getByText('Areas without a representative')).toBeInTheDocument();
    expect(screen.getByText('Divisional Leader — Sanaga, Littoral, Cameroon')).toBeInTheDocument();
  });

  it('tapping a leader card navigates to their detailed profile', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: { items: [{ id: 'area-1', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Grace Leader', photoUrl: null }] }] },
      },
    });
    renderWithRoutes();
    fireEvent.click(await screen.findByText('Grace Leader'));
    expect(await screen.findByText('Person Profile Page')).toBeInTheDocument();
  });

  it('submits a request to represent a searched area', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': { status: 200, body: { items: [] } },
      '/geographic-areas?search=Bepanda': { status: 200, body: { items: [{ id: 'area-q', name: 'Bepanda', level: 'QUARTER', title: 'Quarter Representative', leaders: [] }] } },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-1', status: 'PENDING' } },
    });
    renderWithRoutes();
    fireEvent.change(await screen.findByPlaceholderText('Search for an area, e.g. Bepanda'), { target: { value: 'Bepanda' } });
    fireEvent.click(screen.getByText('Search'));
    fireEvent.click(await screen.findByText(/Bepanda/));
    fireEvent.click(screen.getByText('Submit request'));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/area-representation-requests') && (c.body as any)?.areaId === 'area-q')).toBe(true);
    });
  });

  it('shows the pending request state and lets the member withdraw it', async () => {
    mockFetchByUrl({
      '/geographic-areas/countries': { status: 200, body: { items: [{ id: 'c1', name: 'Cameroon', country: 'Cameroon' }] } },
      '/area-representation-requests/mine': { status: 200, body: { items: [{ id: 'req-1', note: null, status: 'PENDING', decisionNote: null, area: { id: 'area-q', name: 'Bepanda', level: 'QUARTER' } }] } },
      '/leadership-directory/areas': { status: 200, body: { items: [] } },
      'DELETE /area-representation-requests/req-1': { status: 200, body: { ok: true } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithRoutes();
    expect(await screen.findByText('Bepanda (Quarter)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Withdraw request'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/area-representation-requests/req-1'))).toBe(true);
    });
  });
});
