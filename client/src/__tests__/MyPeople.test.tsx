import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MyPeople } from '../components/leader/MyPeople';

// "Today: my people" — the leader's follow-up cards, most urgent first, with
// a one-tap Message that opens the normal private chat.
const calls: { url: string; method: string }[] = [];
function mockFetch(handlers: Record<string, () => { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      const res = key ? handlers[key]() : { status: 404, body: {} };
      return Promise.resolve({ ok: res.status < 300, status: res.status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const card = (over: Record<string, unknown>) => ({
  followUpAssignmentId: 'a',
  personId: 'p',
  name: 'Someone',
  lastContactAt: null,
  contactDaysThisWeek: 0,
  contactTarget: 2,
  replied: null,
  wellbeing: null,
  note: null,
  nextAction: null,
  prayerRequests: 0,
  attendance: { attended: 0, events: 0 },
  teachingsFinished: 0,
  school: { passed: 0, required: 15 },
  payment: { owedBooks: 0, waitingConfirmation: 0 },
  flags: [],
  conversationId: null,
  ...over,
});

const data = {
  away: null,
  contactTarget: 2,
  total: 2,
  needingAttention: 1,
  items: [
    card({ followUpAssignmentId: 'a1', personId: 'p1', name: 'Marie Ngono', flags: ['EMERGENCY', 'CONTACT_TWICE_WEEK'], wellbeing: 'EMERGENCY', note: 'Lost her job', school: { passed: 6, required: 15 } }),
    card({ followUpAssignmentId: 'a2', personId: 'p2', name: 'Paul Biya', lastContactAt: new Date().toISOString(), contactDaysThisWeek: 2, flags: [], replied: true }),
  ],
};

function show() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MyPeople />} />
        <Route path="/member/chats/private/:id" element={<p>PRIVATE CHAT OPEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MyPeople', () => {
  it('shows who needs the leader, with plain flags and the weekly count', async () => {
    mockFetch({ '/api/leader/my-people': () => ({ status: 200, body: data }) });
    show();
    expect(await screen.findByText('Marie Ngono')).toBeInTheDocument();
    expect(screen.getByText('2 people you follow, 1 need you today.')).toBeInTheDocument();
    expect(screen.getByText('Emergency')).toBeInTheDocument();
    expect(screen.getByText('Less than twice this week')).toBeInTheDocument();
    expect(screen.getByText(/Not contacted yet · 0 of 2 days this week/)).toBeInTheDocument();
    expect(screen.getByText(/In touch today · 2 of 2 days this week/)).toBeInTheDocument();
  });

  it('opens a card to show the whole picture of one person', async () => {
    mockFetch({ '/api/leader/my-people': () => ({ status: 200, body: data }) });
    show();
    fireEvent.click(await screen.findByText('Marie Ngono'));
    expect(screen.getByText('6 / 15')).toBeInTheDocument();
    expect(screen.getByText('Lost her job')).toBeInTheDocument();
    expect(screen.getByText('Nothing owed')).toBeInTheDocument();
  });

  it('can show only the people who need the leader', async () => {
    mockFetch({ '/api/leader/my-people': () => ({ status: 200, body: data }) });
    show();
    await screen.findByText('Paul Biya');
    fireEvent.click(screen.getByLabelText('Only those who need me'));
    expect(screen.queryByText('Paul Biya')).not.toBeInTheDocument();
    expect(screen.getByText('Marie Ngono')).toBeInTheDocument();
  });

  it('Message opens the private chat', async () => {
    mockFetch({
      '/api/leader/my-people/p1/chat': () => ({ status: 200, body: { conversationId: 'c-9' } }),
      '/api/leader/my-people': () => ({ status: 200, body: data }),
    });
    show();
    await screen.findByText('Marie Ngono');
    fireEvent.click(screen.getAllByRole('button', { name: 'Message' })[0]);
    await waitFor(() => expect(screen.getByText('PRIVATE CHAT OPEN')).toBeInTheDocument());
    expect(calls.some((c) => c.url.endsWith('/api/leader/my-people/p1/chat') && c.method === 'POST')).toBe(true);
  });

  it('lets a leader say they are away, and shows it', async () => {
    mockFetch({
      '/api/leader/my-people/away': () => ({ status: 200, body: { away: { until: '2026-12-01T00:00:00.000Z' } } }),
      '/api/leader/my-people': () => ({ status: 200, body: data }),
    });
    show();
    await screen.findByText('Marie Ngono');
    fireEvent.change(screen.getByLabelText('I am away until'), { target: { value: '2999-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved. You will not be given new people while you are away.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/api/leader/my-people/away') && c.method === 'PUT')).toBe(true);
  });

  it('shares or hands over a person with a colleague', async () => {
    mockFetch({
      '/api/leader/my-people/p1/share': () => ({ status: 200, body: { mode: 'share', done: true } }),
      '/api/leader/my-people/colleagues': () => ({ status: 200, body: { items: [{ communityId: 'c', communityName: 'A', leaders: [{ personId: 'l2', name: 'Otto', away: false, headcount: 4 }] }] } }),
      '/api/leader/my-people': () => ({ status: 200, body: data }),
    });
    show();
    fireEvent.click(await screen.findByText('Marie Ngono'));
    const select = await screen.findByLabelText('Choose a leader');
    fireEvent.change(select, { target: { value: 'l2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share with them' }));
    expect(await screen.findByText('Shared. They have been told.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/api/leader/my-people/p1/share') && c.method === 'POST')).toBe(true);
  });

  it('shows nothing for a leader who follows nobody', async () => {
    mockFetch({ '/api/leader/my-people': () => ({ status: 200, body: { contactTarget: 2, total: 0, needingAttention: 0, items: [] } }) });
    const { container } = show();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(container.querySelector('[data-testid="my-people"]')).toBeNull();
  });
});
