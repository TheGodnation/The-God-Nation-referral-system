import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberTeachingPage, playedFraction } from '../pages/MemberTeachingPage';
import { MemberTeachingComposePage } from '../pages/MemberTeachingComposePage';
import { TeachingCard } from '../components/teaching/TeachingCard';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// Teachings: the card in the chat, the page (steps, quiz that opens only once
// the system approves, live results list) and the central admin's compose screen.
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
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

const ME = { member: { name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'p-mary', profileComplete: true } };
const CLOSES = new Date(Date.now() + 5 * 86400000).toISOString();

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Walking in love',
    text: 'Love one another as I have loved you.',
    communityId: 'c1',
    communityName: 'HQ',
    messageId: 'm1',
    authorName: 'Coordinator',
    isAuthor: false,
    closesAt: CLOSES,
    mediaKind: null,
    attachments: [],
    minReadSeconds: 0,
    canManage: false,
    quiz: { assessmentId: 'a1', passMark: 70, questionCount: 5, state: 'LOCKED', percentage: null, passed: null },
    me: { textRead: false, mediaFraction: 0, mediaDone: false, completed: false },
    ...over,
  };
}

const RESULTS = {
  totals: { members: 40, opened: 14, finished: 12, taken: 9, passed: 8, averagePercentage: 76 },
  passMark: 70,
  closesAt: CLOSES,
  participants: [
    { personId: 'p-ann', name: 'Ann Fon', photoUrl: null, finishedAt: '2026-10-24T10:00:00Z', percentage: 100, passed: true, takenAt: '2026-10-24T10:05:00Z' },
    { personId: 'p-mary', name: 'Mary', photoUrl: null, finishedAt: '2026-10-24T10:10:00Z', percentage: 40, passed: false, takenAt: '2026-10-24T10:15:00Z' },
    { personId: 'p-ben', name: 'Ben Ngu', photoUrl: null, finishedAt: '2026-10-24T10:20:00Z', percentage: null, passed: null, takenAt: null },
  ],
};

function renderPage(d: ReturnType<typeof detail>, extra: Record<string, (b: any) => { status?: number; body: unknown }> = {}, results: object = RESULTS) {
  mockFetch({
    'GET /api/settings/public': () => ({ status: 404, body: {} }),
    'GET /api/member/auth/me': () => ({ body: ME }),
    'GET /api/teachings/t1/results': () => ({ body: results }),
    'GET /api/teachings/t1': () => ({ body: d }),
    'POST /api/teachings/t1/progress': () => ({ body: { me: d.me, quiz: d.quiz } }),
    ...extra,
  });
  return render(
    <MemoryRouter initialEntries={['/member/teachings/t1']}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/teachings/:id" element={<MemberTeachingPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('The teaching card in the chat', () => {
  it('says where the viewer is and opens the teaching', () => {
    const base = { id: 't1', title: 'Walking in love', mediaKind: 'AUDIO' as const, hasText: true, closesAt: CLOSES, myPercentage: null };
    const { rerender } = render(
      <MemoryRouter>
        <TeachingCard teaching={{ ...base, myState: 'NEW' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Walking in love')).toBeInTheDocument();
    expect(screen.getByText('Not opened yet')).toBeInTheDocument();
    expect(screen.getByTestId('teaching-card')).toHaveAttribute('href', '/member/teachings/t1');
    rerender(
      <MemoryRouter>
        <TeachingCard teaching={{ ...base, myState: 'PASSED', myPercentage: 80 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Passed — 80%')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <TeachingCard teaching={{ ...base, myState: 'FINISHED' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('You finished — the quiz is open')).toBeInTheDocument();
  });
});

describe('The teaching page', () => {
  it('shows the steps and a locked quiz, and the live list with scores for everyone', async () => {
    renderPage(detail());
    expect(await screen.findByText('Walking in love')).toBeInTheDocument();
    expect(screen.getByText('Read the teaching to the end')).toBeInTheDocument();
    expect(within(screen.getByTestId('teaching-quiz')).getByText(/The quiz opens once you have finished/)).toBeInTheDocument();
    expect(screen.queryByTestId('teaching-start-quiz')).not.toBeInTheDocument();

    expect(await screen.findByTestId('teaching-totals')).toHaveTextContent('12 of 40 members finished');
    expect(screen.getByTestId('teaching-totals')).toHaveTextContent('9 took the quiz, 8 passed');
    expect(screen.getByTestId('teaching-totals')).toHaveTextContent('average 76%');
    const rows = within(screen.getByTestId('teaching-participants')).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Ann Fon');
    expect(rows[0]).toHaveTextContent('100%');
    expect(rows[1]).toHaveTextContent('(you)');
    expect(rows[1]).toHaveTextContent('40%');
    expect(rows[2]).toHaveTextContent('quiz not taken yet');
    // Opening the page was reported.
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/teachings/t1/progress' && JSON.stringify(c.body) === '{}')).toBe(true);
  });

  it('reports the text as read once the end was reached, then the quiz opens', async () => {
    const done = { textRead: true, mediaFraction: 0, mediaDone: false, completed: true };
    const open = { assessmentId: 'a1', passMark: 70, questionCount: 5, state: 'AVAILABLE', percentage: null, passed: null };
    renderPage(detail(), {
      'POST /api/teachings/t1/progress': (b) => ({ body: b?.textRead ? { me: done, quiz: open } : { me: detail().me, quiz: detail().quiz } }),
    });
    const start = await screen.findByTestId('teaching-start-quiz', undefined, { timeout: 5000 });
    expect(start).toHaveAttribute('href', '/member/assessments/a1');
    expect(calls.some((c) => c.method === 'POST' && c.body?.textRead === true)).toBe(true);
    expect(screen.getByText('✓ The system has confirmed you finished the teaching.')).toBeInTheDocument();
  });

  it('shows your score when you have taken the quiz', async () => {
    renderPage(
      detail({ quiz: { assessmentId: 'a1', passMark: 70, questionCount: 5, state: 'DONE', percentage: 80, passed: true }, me: { textRead: true, mediaFraction: 0, mediaDone: false, completed: true } }),
    );
    expect(await screen.findByText('You passed — 80%')).toBeInTheDocument();
  });

  it('shows every member who is still pending, and tells you if you are one of them', async () => {
    renderPage(detail(), {}, { ...RESULTS, notFinished: [{ personId: 'p-x', name: 'Xavier', photoUrl: null }, { personId: 'p-mary', name: 'Mary', photoUrl: null }] });
    const pending = await screen.findByTestId('teaching-pending');
    expect(pending).toHaveTextContent('Not finished yet: 2');
    expect(pending).toHaveTextContent('These brethren have not finished yet.');
    expect(pending).not.toHaveTextContent('encourage one another');
    expect(pending).toHaveTextContent('Xavier');
    expect(pending).toHaveTextContent('Mary (you)');
    expect(pending).toHaveTextContent('You are still pending');
    // Only the central admin has the reminder button.
    expect(screen.queryByRole('button', { name: /Remind them/ })).not.toBeInTheDocument();
  });

  it('says so when everyone has finished', async () => {
    renderPage(detail(), {}, { ...RESULTS, notFinished: [] });
    expect(await screen.findByText('Everyone has finished. Well done!')).toBeInTheDocument();
  });

  it('gives the central admin the same list and a reminder button', async () => {
    renderPage(detail({ canManage: true }), {
      'POST /api/teachings/t1/remind': () => ({ body: { sent: 2 } }),
    }, { ...RESULTS, notFinished: [{ personId: 'p-x', name: 'Xavier' }, { personId: 'p-y', name: 'Yvonne' }] });
    expect(await screen.findByText('Xavier')).toBeInTheDocument();
    expect(screen.queryByText(/You are still pending/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remind them/ }));
    expect(await screen.findByText('Reminder sent to 2 people.')).toBeInTheDocument();
  });

  it('says so when the teaching is not available', async () => {
    mockFetch({
      'GET /api/settings/public': () => ({ status: 404, body: {} }),
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/teachings/t1': () => ({ status: 404, body: { error: 'nope' } }),
    });
    render(
      <MemoryRouter initialEntries={['/member/teachings/t1']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/teachings/:id" element={<MemberTeachingPage />} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This teaching is not available.')).toBeInTheDocument();
  });
});

describe('Counting what was really played', () => {
  const ranges = (list: [number, number][]) => ({ length: list.length, start: (i: number) => list[i][0], end: (i: number) => list[i][1] }) as unknown as TimeRanges;
  it('adds up the played parts, so skipping ahead does not count', () => {
    expect(playedFraction({ played: ranges([[0, 30]]), duration: 100 })).toBeCloseTo(0.3);
    expect(playedFraction({ played: ranges([[0, 30], [80, 100]]), duration: 100 })).toBeCloseTo(0.5);
    expect(playedFraction({ played: ranges([[90, 100]]), duration: 100 })).toBeCloseTo(0.1);
    expect(playedFraction({ played: ranges([]), duration: 100 })).toBe(0);
    expect(playedFraction({ played: ranges([[0, 5]]), duration: NaN })).toBe(0);
  });
});

describe('Posting a teaching', () => {
  function renderCompose(extra: Record<string, (b: any) => { status?: number; body: unknown }> = {}) {
    mockFetch({
      'GET /api/settings/public': () => ({ status: 404, body: {} }),
      'GET /api/member/auth/me': () => ({ body: ME }),
      ...extra,
    });
    return render(
      <MemoryRouter initialEntries={['/member/chats/group/c1/teaching/new']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/chats/group/:communityId/teaching/new" element={<MemberTeachingComposePage />} />
            <Route path="/member/teachings/:id" element={<p>Teaching page</p>} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
  }

  it('drafts questions with AI, lets the admin check them, then posts', async () => {
    renderCompose({
      'POST /api/teachings/draft-questions': () => ({
        body: {
          questions: [
            { textEn: 'Who is the teaching about?', textFr: 'De qui parle-t-il ?', options: [{ textEn: 'Moses', textFr: 'Moïse' }, { textEn: 'Jesus', textFr: 'Jésus' }, { textEn: 'Paul', textFr: 'Paul' }], correctIndex: 1 },
          ],
        },
      }),
      'POST /api/teachings': () => ({ status: 201, body: { id: 't9' } }),
    });
    const post = screen.getByRole('button', { name: 'Post the teaching' });
    expect(post).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Walking in love' } });
    fireEvent.change(screen.getByLabelText(/Written teaching/), { target: { value: 'Love one another.' } });
    fireEvent.click(screen.getByRole('button', { name: /Draft questions with AI/ }));

    expect(await screen.findByDisplayValue('Who is the teaching about?')).toBeInTheDocument();
    // The AI's choice of the right answer is pre-selected and can be changed.
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[1]).toBeChecked();
    fireEvent.click(radios[0]);
    expect(radios[0]).toBeChecked();

    const drafted = calls.find((c) => c.url === '/api/teachings/draft-questions');
    expect(drafted?.body).toMatchObject({ communityId: 'c1', text: 'Love one another.', count: 5 });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Post the teaching' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Post the teaching' }));
    expect(await screen.findByText('Teaching page')).toBeInTheDocument();
    const posted = calls.find((c) => c.method === 'POST' && c.url === '/api/teachings');
    expect(posted?.body).toMatchObject({ communityId: 'c1', title: 'Walking in love', text: 'Love one another.', passMark: 70, openDays: 7 });
    expect(posted?.body.questions[0].options.map((o: any) => o.isCorrect)).toEqual([true, false, false]);
  });

  it('shows the assistant’s reason when drafting is not possible, and keeps manual questions', async () => {
    renderCompose({ 'POST /api/teachings/draft-questions': () => ({ status: 503, body: { error: 'The question assistant is not set up. Please write the questions yourself.', code: 'AI_OFF' } }) });
    fireEvent.change(screen.getByLabelText(/Written teaching/), { target: { value: 'Some text' } });
    fireEvent.click(screen.getByRole('button', { name: /Draft questions with AI/ }));
    expect(await screen.findByText(/not set up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add a question/ }));
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
