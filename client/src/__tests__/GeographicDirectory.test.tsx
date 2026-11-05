import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberRepresentPage } from '../pages/MemberRepresentPage';
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

// "Request to represent your area" is a page of its own; it opens with the form ready.
function renderRepresent(path = '/member/represent') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/member/represent" element={<MemberRepresentPage />} />
        <Route path="/member/representatives" element={<div>The wall</div>} />
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
const SUBDIVISION_OPTIONS = { items: [{ id: 's1', name: 'Douala V', level: 'SUBDIVISION' }] };
const QUARTER_OPTIONS = { items: [{ id: 'q1', name: 'Bonamoussadi', level: 'QUARTER' }] };

describe('GeographicDirectory (Member)', () => {
  it('asks for the country, region, division and exact subdivision, then what to represent: the subdivision or a quarter within it', async () => {
    mockFetchByUrl({
      '/geographic-areas/countries': { status: 200, body: { items: [] } },
      '/area-representation-requests/mine': { status: 200, body: { items: [] } },
      '/leadership-directory/subdivision-status': { status: 200, body: { represented: false, representatives: [] } },
      'POST /area-representation-requests': { status: 201, body: { id: 'r1' } },
    });
    renderRepresent();
    expect(await screen.findByText('Represent The God Nation in your area')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Submit request' });
    expect(send).toBeDisabled();
    expect((screen.getByLabelText('Country') as HTMLSelectElement).value).toBe('Cameroon');
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'Littoral' } });
    // A region or a division alone is not enough: the exact subdivision is needed.
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'Wouri' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Subdivision'), { target: { value: 'Douala V' } });
    expect(screen.getByText(/Write or choose the exact subdivision/)).toBeInTheDocument();
    // The choice appears: the whole subdivision, or a quarter within it.
    const scope = await screen.findByTestId('scope');
    expect(scope).toHaveTextContent('What do you want to represent?');
    expect(scope).toHaveTextContent('The whole subdivision: Douala V');
    expect(screen.queryByLabelText('Quarter')).toBeNull();
    await waitFor(() => expect(send).toBeEnabled());
    // Wanting a quarter brings the quarter field, and it must be filled.
    fireEvent.click(screen.getByLabelText('A quarter within Douala V'));
    expect(send).toBeDisabled();
    fireEvent.change(await screen.findByLabelText('Quarter'), { target: { value: 'Bonamoussadi' } });
    expect(screen.getByTestId('asking-for')).toHaveTextContent('Quarter — Bonamoussadi (Douala V)');
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ typedCountry: 'Cameroon', typedRegion: 'Littoral', typedDivision: 'Wouri', typedSubdivision: 'Douala V', typedQuarter: 'Bonamoussadi' }));
  });

  it('opens the request form at once on its own page', async () => {
    mockFetchByUrl(BASE_ROUTES as never);
    renderRepresent();
    expect(await screen.findByRole('button', { name: 'Submit request' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Request to represent your area' })).toBeInTheDocument();
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

  it('asking for the whole subdivision sends the subdivision with no quarter', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/subdivision-status': { status: 200, body: { represented: false, representatives: [] } },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-1', status: 'PENDING' } },
    });
    renderRepresent();
    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'South-West' } });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'Fako' } });
    expect(Array.from((screen.getByLabelText('Subdivision') as HTMLSelectElement).options).map((o) => o.value)).toContain('Buea');
    fireEvent.change(screen.getByLabelText('Subdivision'), { target: { value: 'Buea' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled());
    expect(screen.getByTestId('asking-for')).toHaveTextContent('Subdivision — Buea');
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/area-representation-requests'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/area-representation-requests'))!;
    expect(post.body).toMatchObject({ typedCountry: 'Cameroon', typedRegion: 'South-West', typedDivision: 'Fako', typedSubdivision: 'Buea' });
    expect((post.body as any).typedQuarter).toBeUndefined();
    expect((post.body as any).areaId).toBeUndefined();
    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
  });

  it('when the subdivision already has a representative, it says so and only a quarter within it can be sent', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/subdivision-status': { status: 200, body: { represented: true, representatives: ['Grace Leader'] } },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-9', status: 'PENDING' } },
    });
    renderRepresent();
    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'South-West' } });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'Fako' } });
    fireEvent.change(screen.getByLabelText('Subdivision'), { target: { value: 'Buea' } });
    expect(await screen.findByTestId('subdivision-taken')).toHaveTextContent('Grace Leader already represents this subdivision');
    // The "whole subdivision" choice is closed; the quarter is asked for, and must be given.
    expect(screen.getByLabelText('The whole subdivision: Buea')).toBeDisabled();
    expect(screen.getByLabelText('A quarter within Buea')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    fireEvent.change(await screen.findByLabelText('Quarter'), { target: { value: 'Molyko' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && (c.body as any)?.typedQuarter === 'Molyko' && (c.body as any)?.typedSubdivision === 'Buea')).toBe(true));
  });

  it('"Represent this place" on a vacant area opens the request for exactly that place', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      '/leadership-directory/areas': {
        status: 200,
        body: { items: [{ id: 'area-2', name: 'Edéa I', level: 'SUBDIVISION', title: 'Subdivisional Leader', path: 'Edéa I, Sanaga-Maritime, Littoral, Cameroon', leaders: [] }, { id: 'area-3', name: 'Sanaga-Maritime', level: 'DIVISION', title: 'Divisional Leader', path: 'Sanaga-Maritime, Littoral, Cameroon', leaders: [] }] },
      },
      'POST /area-representation-requests': { status: 201, body: { id: 'req-3', status: 'PENDING' } },
    });
    renderWithRoutes();
    // Only the subdivision can be asked for; the vacant division has no button (the central authority appoints those).
    expect(await screen.findAllByRole('button', { name: 'Represent this place' })).toHaveLength(1);
  });

  it('arriving with a chosen place, the request page asks for exactly that place', async () => {
    mockFetchByUrl({
      ...BASE_ROUTES,
      'POST /area-representation-requests': { status: 201, body: { id: 'req-3', status: 'PENDING' } },
    });
    renderRepresent('/member/represent?areaId=area-2&label=Subdivisional%20Leader%20%E2%80%94%20Ed%C3%A9a%20I');
    expect(await screen.findByText(/Edéa I/)).toBeInTheDocument();
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
    renderRepresent();
    expect(await screen.findByText('Mile 17, Fako, South West')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Withdraw request'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/area-representation-requests/req-1'))).toBe(true);
    });
  });
});
