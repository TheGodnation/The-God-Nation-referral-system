import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberPeoplePage } from '../pages/MemberPeoplePage';
import { MemberPersonPage } from '../pages/MemberPersonPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { ReportsList } from '../components/ReportsList';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

const ME = { member: { name: 'Me', email: 'me@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'me' } };
const card = (personId: string, name: string, extra: Record<string, unknown> = {}) => ({
  personId,
  name,
  photoUrl: null,
  area: 'Yaoundé III, Centre',
  friendStatus: 'NONE',
  requestId: null,
  ...extra,
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/people" element={<MemberPeoplePage />} />
          <Route path="/member/people/:personId" element={<MemberPersonPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('People page', () => {
  it('shows requests, people near me and friends; accepting a request', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/friends/requests': () => ({ body: { incoming: [card('p1', 'Ada', { friendStatus: 'REQUEST_RECEIVED', requestId: 'r1' })], outgoing: [] } }),
      'GET /api/member/people/near': () => ({ body: { items: [card('p2', 'Neighbour Ben')] } }),
      'GET /api/member/people/suggested': () => ({ body: { items: [] } }),
      'GET /api/member/friends': () => ({ body: { items: [] } }),
      'GET /api/member/me/social-settings': () => ({ body: { friendRequestPolicy: 'EVERYONE' } }),
      'POST /api/member/friends/requests/r1/accept': () => ({ body: { friendStatus: 'FRIENDS' } }),
      'POST /api/member/friends/requests': () => ({ status: 201, body: { friendStatus: 'REQUEST_SENT', requestId: 'r2' } }),
    });
    renderAt('/member/people');

    const requests = (await screen.findByRole('heading', { name: 'Friend requests' })).closest('section')!;
    fireEvent.click(within(requests).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(within(requests).getByRole('button', { name: /Friends/ })).toBeInTheDocument());

    const near = screen.getByRole('heading', { name: 'People near you' }).closest('section')!;
    expect(within(near).getByText('Neighbour Ben')).toBeInTheDocument();
    fireEvent.click(within(near).getByRole('button', { name: /Add friend/ }));
    await waitFor(() => expect(within(near).getByRole('button', { name: 'Cancel request' })).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/member/friends/requests')?.body).toEqual({ personId: 'p2' });
  });

  it('searches by name', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/people?search=': () => ({ body: { items: [card('p3', 'Grace Found')] } }),
      'GET /api/member/': () => ({ body: { items: [], incoming: [], outgoing: [] } }),
    });
    renderAt('/member/people');
    fireEvent.change(await screen.findByLabelText('Search members by name'), { target: { value: 'gra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Grace Found')).toBeInTheDocument();
  });
});

describe('Person profile page', () => {
  const profile = {
    personId: 'p9',
    name: 'Paul Profile',
    photoUrl: null,
    area: 'Douala V, Littoral',
    isLeader: false,
    sameGroup: false,
    friendStatus: 'FRIENDS',
    requestId: 'f1',
    friendCount: 3,
    canMessage: true,
  };

  it('lets friends send a message', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/people/p9': () => ({ body: profile }),
      'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items: [], nextBefore: null } }),
      'POST /api/member/messages/start': () => ({ status: 201, body: { conversationId: 'c1' } }),
    });
    renderAt('/member/people/p9');
    expect(await screen.findByRole('heading', { name: 'Paul Profile' })).toBeInTheDocument();
    expect(screen.getByText('Douala V, Littoral · 3 friends')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Message/ }));
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Hello Paul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Message sent/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/member/messages/start')?.body).toEqual({ personId: 'p9', body: 'Hello Paul' });
  });

  it('hides Message for strangers and explains why', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/people/p9': () => ({ body: { ...profile, friendStatus: 'NONE', canMessage: false } }),
      'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items: [], nextBefore: null } }),
    });
    renderAt('/member/people/p9');
    await screen.findByRole('heading', { name: 'Paul Profile' });
    expect(screen.queryByRole('button', { name: /Message/ })).not.toBeInTheDocument();
    expect(screen.getByText('Become friends to send a message.')).toBeInTheDocument();
  });

  it('sends a report with a reason', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/people/p9': () => ({ body: profile }),
      'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items: [], nextBefore: null } }),
      'POST /api/member/reports': () => ({ status: 201, body: { id: 'rep1' } }),
    });
    renderAt('/member/people/p9');
    await screen.findByRole('heading', { name: 'Paul Profile' });
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'He asked me for money' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thank you. Your report was sent to the leaders.')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/member/reports')?.body).toEqual({ personId: 'p9', targetType: 'PERSON', reason: 'He asked me for money' });
  });
});

describe('ReportsList', () => {
  it('shows open reports and marks one as dealt with', async () => {
    let open = true;
    mockFetch({
      'GET /api/admin/member-reports': () => ({
        body: {
          items: open
            ? [{ id: 'r1', targetType: 'PERSON', reason: 'Spam', status: 'OPEN', createdAt: '2026-10-05T10:00:00Z', resolvedAt: null, resolutionNote: null, reporter: { personId: 'a', name: 'Ada' }, reported: { personId: 'b', name: 'Bob' } }]
            : [],
        },
      }),
      'POST /api/admin/member-reports/r1/resolve': () => {
        open = false;
        return { body: { ok: true } };
      },
    });
    render(<ReportsList basePath="/api/admin/member-reports" />);
    expect(await screen.findByText('“Spam”')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Warned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as dealt with' }));
    expect(await screen.findByText('No open reports.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ note: 'Warned' });
  });

  it('hides itself for viewers who may not review reports', async () => {
    mockFetch({ 'GET /api/leader/member-reports': () => ({ status: 403, body: { error: 'no' } }) });
    const { container } = render(<ReportsList basePath="/api/leader/member-reports" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
