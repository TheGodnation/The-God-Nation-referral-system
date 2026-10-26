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
        .find((key) => {
          const m = /^(GET|POST|PATCH|DELETE) (.*)$/.exec(key);
          return m ? m[1] === method && url.includes(m[2]) : method === 'GET' && url.includes(key);
        });
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
  '/leadership-directory/national-team': { status: 200, body: { items: [] } },
};

const REGION_OPTIONS = { items: [{ id: 'r1', name: 'Littoral', level: 'REGION' }, { id: 'r2', name: 'South West', level: 'REGION' }] };
const DIVISION_OPTIONS = { items: [{ id: 'd1', name: 'Wouri', level: 'DIVISION' }] };

describe('GeographicDirectory (Member)', () => {
  it('with no places or leaders set up yet, the member can still ask to represent their area (typing their place)', async () => {
    mockFetchByUrl({
      '/geographic-areas/countries': { status: 200, body: { items: [] } },
      '/area-representation-requests/mine': { status: 200, body: { items: [] } },
      '/leadership-directory/national-team': { status: 200, body: { items: [] } },
      'POST /area-representation-requests': { status: 201, body: { id: 'r1' } },
    });
    renderWithRoutes();
    expect(await screen.findByText('Represent The God Nation in your area')).toBeInTheDocument();
    expect(screen.getByText(/No leaders have been appointed yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request to represent my area' }));
    // There is no list to pick from, so the place is typed, with the country.
    const send = screen.getByRole('button', { name: 'Submit request' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Country/), { target: { value: 'Cameroon' } });
    fireEvent.change(screen.getByLabelText(/Region/), { target: { value: 'Littoral' } });
    fireEvent.change(screen.getByLabelText(/Quarter/), { target: { value: 'Bepanda' } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ typedCountry: 'Cameroon', typedRegion: 'Littoral', typedQuarter: 'Bepanda' }));
  });

  it('opens the request form at once when arriving from the People page button', async () => {
    mockFetchByUrl(BASE_ROUTES as never);
    render(
      <MemoryRouter initialEntries={['/member/leadership#represent']}>
        <Routes>
          <Route path="/member/leadership" element={<GeographicDirectory />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Submit request' })).toBeInTheDocument();
  });

  it('shows a leader as a face card with name, position and place, plus the full path, no profile click needed', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: { items: [{ id: 'area-1', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Grace Leader', photoUrl: null, title: 'Divisional Coordinator' }] }] },
      },
    });
    renderWithRoutes();
    const card = await screen.findByRole('button', { name: 'Grace Leader' });
    expect(card).toHaveTextContent('GL'); // no photo: initials card
    expect(card).toHaveTextContent('Divisional Coordinator · Wouri');
    expect(screen.getByText('Wouri, Littoral, Cameroon')).toBeInTheDocument();
  });

  it('shows the National Team at the top with the titles the admin gave', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/national-team': {
        status: 200,
        body: { items: [{ personId: 't1', name: 'Pastor Team', photoUrl: '/api/people/t1/photo?v=1', title: 'National Coordinator' }] },
      },
      '/leadership-directory/areas': { status: 200, body: { items: [] } },
    });
    renderWithRoutes();
    expect(await screen.findByText('The National Team')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'Pastor Team' });
    expect(card).toHaveTextContent('National Coordinator');
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/people/t1/photo?v=1');
  });

  it('groups leaders by level and lets the member narrow to one level', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: {
          items: [
            { id: 'a1', name: 'Littoral', level: 'REGION', title: 'Regional Leader', path: 'Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Rita Region', photoUrl: null, title: 'Regional Leader' }] },
            { id: 'a2', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p2', name: 'Dan Division', photoUrl: null, title: 'Divisional Leader' }] },
          ],
        },
      },
    });
    renderWithRoutes();
    expect(await screen.findByRole('button', { name: 'Rita Region' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dan Division' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Division' }));
    expect(screen.queryByRole('button', { name: 'Rita Region' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dan Division' })).toBeInTheDocument();
  });

  it('clearly lists areas with no assigned representative, separately from represented ones', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: {
          items: [
            { id: 'area-1', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Grace Leader', photoUrl: null, title: 'Divisional Leader' }] },
            { id: 'area-2', name: 'Sanaga', level: 'DIVISION', title: 'Divisional Leader', path: 'Sanaga, Littoral, Cameroon', leaders: [] },
          ],
        },
      },
    });
    renderWithRoutes();
    expect(await screen.findByRole('button', { name: 'Grace Leader' })).toBeInTheDocument();
    expect(screen.getByText('Areas without a representative')).toBeInTheDocument();
    expect(screen.getByText('Divisional Leader — Sanaga, Littoral, Cameroon')).toBeInTheDocument();
  });

  it('tapping a leader card navigates to their detailed profile', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: { items: [{ id: 'area-1', name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon', leaders: [{ personId: 'p1', name: 'Grace Leader', photoUrl: null, title: 'Divisional Leader' }] }] },
      },
    });
    renderWithRoutes();
    fireEvent.click(await screen.findByRole('button', { name: 'Grace Leader' }));
    expect(await screen.findByText('Person Profile Page')).toBeInTheDocument();
  });

  it('requests an area by choosing region, then division, from the lists', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': { status: 200, body: { items: [] } },
      '/geographic-areas?parentId=c1': { status: 200, body: REGION_OPTIONS },
      '/geographic-areas?parentId=r1': { status: 200, body: DIVISION_OPTIONS },
      '/geographic-areas?parentId=d1': { status: 200, body: { items: [] } },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-1', status: 'PENDING' } },
    });
    renderWithRoutes();
    fireEvent.click(await screen.findByRole('button', { name: 'Request to represent my area' }));
    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'r1' } });
    fireEvent.change(await screen.findByLabelText('Division'), { target: { value: 'd1' } });
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/area-representation-requests') && (c.body as any)?.areaId === 'd1')).toBe(true);
    });
    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByText(/Your request has been sent/)).toBeInTheDocument();
  });

  it('lets the member type their place when it is not on the list', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': { status: 200, body: { items: [] } },
      '/geographic-areas?parentId=c1': { status: 200, body: REGION_OPTIONS },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-2', status: 'PENDING' } },
    });
    renderWithRoutes();
    fireEvent.click(await screen.findByRole('button', { name: 'Request to represent my area' }));
    fireEvent.click(await screen.findByLabelText("My place isn't listed"));
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled(); // needs at least the region
    fireEvent.change(screen.getByLabelText('Region *'), { target: { value: 'South West' } });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'Fako' } });
    fireEvent.change(screen.getByLabelText('Quarter or locality'), { target: { value: 'Mile 17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/area-representation-requests'));
      expect(post?.body).toMatchObject({ typedCountry: 'Cameroon', typedRegion: 'South West', typedDivision: 'Fako', typedQuarter: 'Mile 17' });
      expect((post?.body as any).areaId).toBeUndefined();
    });
  });

  it('"Represent this place" on a vacant area opens the request for exactly that place', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: { items: [{ id: 'area-2', name: 'Sanaga', level: 'DIVISION', title: 'Divisional Leader', path: 'Sanaga, Littoral, Cameroon', leaders: [] }] },
      },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-3', status: 'PENDING' } },
    });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    renderWithRoutes();
    fireEvent.click(await screen.findByRole('button', { name: 'Represent this place' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit request' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && (c.body as any)?.areaId === 'area-2')).toBe(true);
    });
  });

  it('shows the pending request state (also for a typed-in place) and lets the member withdraw it', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/area-representation-requests/mine': {
        status: 200,
        body: { items: [{ id: 'req-1', note: null, status: 'PENDING', decisionNote: null, area: null, typedRegion: 'South West', typedDivision: 'Fako', typedQuarter: 'Mile 17' }] },
      },
      '/leadership-directory/areas': { status: 200, body: { items: [] } },
      'DELETE /area-representation-requests/req-1': { status: 200, body: { ok: true } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithRoutes();
    expect(await screen.findByText('Mile 17, Fako, South West')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request to represent my area' })).toBeNull();
    fireEvent.click(screen.getByText('Withdraw request'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/area-representation-requests/req-1'))).toBe(true);
    });
  });
});
