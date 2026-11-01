import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Escalations } from '../components/leader/Escalations';
import { MyPeople } from '../components/leader/MyPeople';

// Hard questions: the leader asks from a person's card; the answer thread is
// shown to the asker, the parent leaders and the central admin.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(handlers: Record<string, () => { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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

const item = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  askerName: 'Ada',
  aboutName: 'Sam',
  communityName: 'Child assembly',
  question: 'What should I do about his debts?',
  urgent: true,
  level: 'PARENT_LEADERS',
  status: 'OPEN',
  dueAt: null,
  bypassReason: null,
  createdAt: '2026-11-01T10:00:00Z',
  mine: false,
  messages: [{ id: 'm1', senderName: 'Ada', mine: false, body: 'What should I do about his debts?', createdAt: '2026-11-01T10:00:00Z' }],
  ...over,
});

describe('Escalations list', () => {
  it('shows an urgent open question, opens its thread and sends an answer', async () => {
    mockFetch({
      '/api/leader/escalations/e1/messages': () => ({ status: 201, body: {} }),
      '/api/leader/escalations/inbox': () => ({ status: 200, body: { items: [item()] } }),
    });
    render(<Escalations messagesBase="/api/leader/escalations" lists={[{ key: 'inbox', title: 'Questions sent to me', url: '/api/leader/escalations/inbox', empty: 'Nothing here.' }]} />);
    expect(await screen.findByText('Ada about Sam')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the leaders above')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ada about Sam'));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Pray with him first.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/leader/escalations/e1/messages'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ body: 'Pray with him first.' });
  });

  it('says a passed-on question is with the central administration, and shows nothing when empty if asked to hide', async () => {
    mockFetch({ '/api/x': () => ({ status: 200, body: { items: [item({ level: 'CENTRAL_ADMIN', bypassReason: 'NO_REPLY' })] } }) });
    const { unmount } = render(<Escalations messagesBase="/api/x" lists={[{ key: 'a', title: 'T', url: '/api/x', empty: 'E' }]} />);
    expect(await screen.findByText('Passed on to the central administration')).toBeInTheDocument();
    unmount();
    mockFetch({ '/api/x': () => ({ status: 200, body: { items: [] } }) });
    const { container } = render(<Escalations hideWhenEmpty messagesBase="/api/x" lists={[{ key: 'a', title: 'T', url: '/api/x', empty: 'E' }]} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(container.querySelector('[data-testid="escalations"]')).toBeNull();
  });
});

describe('Ask for help from a person card', () => {
  const card = {
    followUpAssignmentId: 'a1', personId: 'p1', name: 'Sam', lastContactAt: null, contactDaysThisWeek: 0, contactTarget: 2, replied: null, wellbeing: null, note: null,
    nextAction: null, prayerRequests: 0, attendance: { attended: 0, events: 0 }, teachingsFinished: 0, school: { passed: 0, required: 15 },
    payment: { owedBooks: 0, waitingConfirmation: 0 }, flags: [], conversationId: null,
  };
  it('sends the question to the leaders above, flagged urgent', async () => {
    mockFetch({
      '/api/leader/escalations': () => ({ status: 201, body: { id: 'e9', level: 'PARENT_LEADERS', bypassed: false } }),
      '/api/leader/my-people/colleagues': () => ({ status: 200, body: { items: [] } }),
      '/api/leader/my-people': () => ({ status: 200, body: { away: null, contactTarget: 2, total: 1, needingAttention: 0, items: [card] } }),
    });
    render(<MemoryRouter><MyPeople /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Sam'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for help' }));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'He has stopped answering.' } });
    fireEvent.click(screen.getByLabelText('This is urgent'));
    fireEvent.click(screen.getByRole('button', { name: 'Send the question' }));
    expect(await screen.findByText('Sent. You will be told when it is answered.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/leader/escalations'))?.body).toEqual({ aboutPersonId: 'p1', question: 'He has stopped answering.', urgent: true, to: 'PARENT' });
  });
});
