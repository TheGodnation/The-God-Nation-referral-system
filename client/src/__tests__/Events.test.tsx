import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberEventsPage } from '../pages/MemberEventsPage';
import { MemberEventPage } from '../pages/MemberEventPage';
import { EventsCard } from '../components/member/EventsCard';

// The events calendar, one event (I will come / the recording) and the
// leader's attendance sheet. Members never mark themselves present.
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
  calls.length = 0;
});

const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
const item = (over: Record<string, unknown> = {}) => ({
  id: 'e1', communityId: 'c1', communityName: 'Douala Assembly', title: 'Sunday gathering', startsAt: soon, endsAt: soon,
  location: 'Hall', onlineUrl: null, cancelled: false, hasReplay: false, going: false, goingCount: 2, presence: null, ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...item(), description: 'Come and pray',
  mine: { live: false, replayDone: false }, replay: null, canManage: false, ...over,
});

const renderEvent = () =>
  render(
    <MemoryRouter initialEntries={['/member/events/e1']}>
      <Routes>
        <Route path="/member/events/:id" element={<MemberEventPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Events calendar', () => {
  it('lists what is coming and what is past, with my own presence', async () => {
    mockFetch({
      'GET /api/events': () => ({ body: { upcoming: [item()], past: [item({ id: 'e0', title: 'Last week', presence: 'REPLAY' })], creatable: [] } }),
    });
    render(<MemoryRouter><MemberEventsPage /></MemoryRouter>);
    expect(await screen.findByText('Sunday gathering')).toBeInTheDocument();
    expect(screen.getByText('Last week')).toBeInTheDocument();
    expect(screen.getByText(/You watched the recording/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ New event' })).toBeNull();
  });

  it('lets a leader add an event, and opens it', async () => {
    mockFetch({
      'GET /api/events/replay-options': () => ({ body: { items: [{ id: 't1', title: 'Teaching one' }] } }),
      'GET /api/events/e9': () => ({ body: detail({ id: 'e9', title: 'Prayer night' }) }),
      'GET /api/events': () => ({ body: { upcoming: [], past: [], creatable: [{ id: 'c1', name: 'Douala Assembly' }] } }),
      'POST /api/events': () => ({ status: 201, body: { id: 'e9' } }),
    });
    render(
      <MemoryRouter initialEntries={['/member/events']}>
        <Routes>
          <Route path="/member/events" element={<MemberEventsPage />} />
          <Route path="/member/events/:id" element={<div>Opened the event</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '+ New event' }));
    fireEvent.change(await screen.findByLabelText(/^Title/), { target: { value: 'Prayer night' } });
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2030-01-05T18:00' } });
    await screen.findByRole('option', { name: 'Teaching one' });
    fireEvent.change(screen.getByLabelText(/Recording for those/), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the event' }));
    expect(await screen.findByText('Opened the event')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/events');
    expect(post?.body).toMatchObject({ communityId: 'c1', title: 'Prayer night', replayTeachingId: 't1' });
    expect(post?.body.startsAt).toMatch(/^2030-01-0[45]T/);
  });
});

describe('One event', () => {
  it('says "I will come"', async () => {
    mockFetch({
      'GET /api/events/e1': () => ({ body: detail() }),
      'PUT /api/events/e1/rsvp': () => ({ body: { going: true, goingCount: 3 } }),
    });
    renderEvent();
    fireEvent.click(await screen.findByRole('button', { name: 'I will come' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/events/e1/rsvp')).toBe(true));
    expect(screen.queryByText('Come and pray')).toBeInTheDocument();
  });

  it('has no way for a member to mark themselves present', async () => {
    mockFetch({ 'GET /api/events/e1': () => ({ body: detail() }) });
    renderEvent();
    await screen.findByRole('button', { name: 'I will come' });
    expect(screen.queryByLabelText('4-digit code')).toBeNull();
    expect(screen.queryByText(/Attendance sheet/)).toBeNull();
  });

  it('offers the recording', async () => {
    mockFetch({
      'GET /api/events/e1': () => ({ body: detail({ replay: { teachingId: 't1', title: 'Sunday message', mediaKind: 'AUDIO' } }) }),
    });
    renderEvent();
    expect(await screen.findByRole('link', { name: /Sunday message/ })).toHaveAttribute('href', '/member/teachings/t1');
  });

  it('shows how I was counted present', async () => {
    mockFetch({ 'GET /api/events/e1': () => ({ body: detail({ mine: { live: false, replayDone: true } }) }) });
    renderEvent();
    expect(await screen.findByText(/counted present by replay/)).toBeInTheDocument();
  });

  it('gives a leader an attendance sheet they can tick', async () => {
    let ticked = false;
    mockFetch({
      'GET /api/events/e1/attendance': () => ({
        body: {
          totals: { members: 2, going: 1, present: ticked ? 1 : 0, live: ticked ? 1 : 0, replay: 0 },
          items: [
            { personId: 'p1', name: 'Marie', photoUrl: null, going: true, live: ticked, replay: false, present: ticked },
            { personId: 'p2', name: 'Paul', photoUrl: null, going: false, live: false, replay: false, present: false },
          ],
        },
      }),
      'GET /api/events/e1': () => ({ body: detail({ canManage: true, presentCount: 0 }) }),
      'PUT /api/events/e1/attendance/p1': (b) => {
        ticked = b.present;
        return { body: { ok: true } };
      },
    });
    renderEvent();
    expect(await screen.findByText('Marie')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark present: Marie/ }));
    expect(await screen.findByRole('button', { name: /Remove mark: Marie/ })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/attendance/p1'))?.body).toEqual({ present: true });
  });

  it('shows who is rarely present, least first, on request', async () => {
    mockFetch({
      'GET /api/events/summary': () => ({ body: { total: 4, items: [{ personId: 'p2', name: 'Paul', photoUrl: null, present: 0 }, { personId: 'p1', name: 'Marie', photoUrl: null, present: 4 }] } }),
      'GET /api/events/e1/attendance': () => ({ body: { totals: { members: 2, going: 0, present: 0, live: 0, replay: 0 }, items: [] } }),
      'GET /api/events/e1': () => ({ body: detail({ canManage: true, presentCount: 0 }) }),
    });
    renderEvent();
    fireEvent.click(await screen.findByRole('button', { name: 'Show who is rarely present' }));
    expect(await screen.findByText('0 of 4')).toBeInTheDocument();
    expect(screen.getByText('4 of 4')).toBeInTheDocument();
  });
});

describe('Events card', () => {
  it('shows the next event', async () => {
    mockFetch({ 'GET /api/events': () => ({ body: { upcoming: [item({ cancelled: true, title: 'Gone' }), item()], past: [], creatable: [] } }) });
    render(<MemoryRouter><EventsCard /></MemoryRouter>);
    expect(await screen.findByText(/Next: Sunday gathering/)).toBeInTheDocument();
  });
});
