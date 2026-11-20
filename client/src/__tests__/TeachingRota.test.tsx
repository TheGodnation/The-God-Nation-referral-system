import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberMyTeachingPage } from '../pages/MemberMyTeachingPage';
import { TeachingStrip } from '../components/teaching/TeachingStrip';
import { TeachingRotaPanel } from '../components/admin/TeachingRotaPanel';
import { TeachingFinishButton, TeachingRatingCard } from '../components/chat/TeachingRatingCard';

vi.mock('../components/member/MemberNav', () => ({ MemberNav: () => null }));
vi.mock('../components/PageShell', () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const text = (topic: string) => ({
  topic,
  bookTitle: 'Kingdom Keys, Volume 3',
  chapter: 'Chapter 14: The Key of Prayer',
  teachingOn: 'Key 9, Prayer.',
  help: 'Prayer is more than asking.',
  meaning: 'Prayer is talking with God.',
  startLabel: 'Start with this story',
  start: 'Hannah wanted a child.',
  ifNotLabel: 'If we do not use this Key',
  ifNot: 'We only worry.',
  dominion: 'In prayer you bring God’s will.',
  verses: ['Matthew 7:7', 'Philippians 4:6'],
});
const week = (over = {}) => ({ weekStart: '2026-11-23', isCurrent: true, startsAt: '2026-11-23T06:00:00.000Z', endsAt: '2026-11-23T06:15:00.000Z', status: 'upcoming', kind: 'key', text: text('Key 9, Prayer'), textLanguage: 'en', book: null, ...over });
const view = (over = {}) => ({ enabled: true, isTeacher: true, language: 'en', started: true, startsOn: '2026-11-23', minutes: 15, weeks: [week(), week({ weekStart: '2026-11-30', isCurrent: false, text: text('Key 11, Confession') })], ...over });

const page = () => render(<MemoryRouter><MemberMyTeachingPage /></MemoryRouter>);

describe('My teaching page', () => {
  it('shows this week’s topic with the time in Cameroon time, the teaching and next week', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(view())));
    page();
    expect(await screen.findByText('Key 9, Prayer')).toBeInTheDocument();
    expect(screen.getByTestId('week-2026-11-23')).toHaveTextContent('07:00'); // 06:00 UTC = 07:00 GMT+1
    expect(screen.getByTestId('week-2026-11-23')).toHaveTextContent('Cameroon time, GMT+1');
    expect(screen.getByText('Key 11, Confession')).toBeInTheDocument(); // next week, to prepare
    expect(screen.getAllByText('Kingdom Keys, Volume 3, Chapter 14: The Key of Prayer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Start with this story').length).toBeGreaterThan(0); // the label comes from the teaching itself
    expect(screen.queryByTestId('teaching-guide')).toBeNull(); // no minute-by-minute guide
    expect(screen.queryByText(/How to teach your 15 minutes/)).toBeNull();
    expect(screen.getByText(/Teach by voice note in the Leadership group/)).toBeInTheDocument();
  });

  it('opens the book only when the teacher is allowed to read it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(view({ weeks: [week({ book: { id: 'b1', canOpen: true } }), week({ weekStart: '2026-11-30', isCurrent: false, book: { id: 'b2', canOpen: false } })] }))));
    page();
    const link = await screen.findByTestId('open-book');
    expect(link).toHaveAttribute('href', '/member/read/b1');
    expect(screen.getAllByTestId('open-book')).toHaveLength(1);
  });

  it('says it is done once the slot has passed, and tells a first-week teacher when it starts', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(view({ started: false, weeks: [week({ status: 'done', isCurrent: false })] }))));
    page();
    expect(await screen.findByTestId('not-started')).toHaveTextContent('Monday');
    expect(screen.getByText('✓ Done for this week')).toBeInTheDocument();
    expect(screen.getByText('Your first teaching')).toBeInTheDocument();
  });

  it('shows nothing about anyone else to a member who is not on the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ enabled: true, isTeacher: false })));
    page();
    expect(await screen.findByTestId('not-a-teacher')).toBeInTheDocument();
    expect(screen.queryByTestId('topic-view')).toBeNull();
  });
});

describe('The strip on the Chats page', () => {
  it('shows a teacher when and what they teach, and nothing to anyone else or while it is off', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(view())));
    const { unmount } = render(<MemoryRouter><TeachingStrip /></MemoryRouter>);
    const strip = await screen.findByTestId('teaching-strip');
    expect(strip).toHaveAttribute('href', '/member/my-teaching');
    expect(strip).toHaveTextContent('Key 9, Prayer');
    unmount();

    for (const body of [{ enabled: true, isTeacher: false }, { enabled: false, isTeacher: false }]) {
      vi.stubGlobal('fetch', vi.fn(() => json(body)));
      const r = render(<MemoryRouter><TeachingStrip /></MemoryRouter>);
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await new Promise((res) => setTimeout(res, 20));
      expect(screen.queryByTestId('teaching-strip')).toBeNull();
      r.unmount();
    }
  });
});

const row = (over = {}) => ({ id: 't1', name: 'Alpha Tester', active: true, personId: null, memberName: null, hasAccount: false, language: null, dayOfWeek: 1, startTime: '07:00', startTopic: 1, upcoming: [{ weekStart: '2026-11-23', number: 1, title: 'Key 9, Prayer' }, { weekStart: '2026-11-30', number: 2, title: 'Key 11, Confession' }], ratings: { total: 0, average: null, counts: { EXCELLENT: 0, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 0 } }, assignment: null, ...over });
const overview = (over = {}) => ({
  settings: { enabled: false, startDate: '2026-11-23', frenchChecked: false, started: false },
  weeks: ['2026-11-23'],
  raters: { communityId: null, communityName: null, count: 1 },
  topics: [{ number: 1, kind: 'key', title: 'Key 9, Prayer', hasFrench: true }],
  teachers: [row()],
  warnings: ['UNMATCHED'],
  frenchNeeded: false,
  ...over,
});

describe('Weekly teaching panel (central admin)', () => {
  it('offers to load the plan when there is none, and posts the file’s content', async () => {
    const posts: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ summary: { topicsAdded: 1, topicsUpdated: 0, teachersAdded: 1, teachersKept: 0 }, overview: overview() });
      }
      return json(overview({ settings: null, topics: [], teachers: [], warnings: ['NO_PLAN'] }));
    }));
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText(/No plan loaded yet/);
    const file = new File([JSON.stringify({ topics: [], teachers: [] })], 'plan.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('plan-input'), { target: { files: [file] } });
    await screen.findByText(/Loaded: 1 new topics/);
    expect(posts[0].url).toBe('/api/admin/teaching-rota/plan');
    expect(posts[0].body).toEqual({ topics: [], teachers: [] });
    expect(screen.getByText('Alpha Tester')).toBeInTheDocument();
  });

  it('refuses a file that is not JSON without sending anything', async () => {
    const fetchMock = vi.fn((url: string) => json(overview({ settings: null, topics: [], teachers: [], warnings: ['NO_PLAN'] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText(/No plan loaded yet/);
    fireEvent.change(screen.getByTestId('plan-input'), { target: { files: [new File(['not json'], 'plan.json')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('not a teaching plan');
    expect(fetchMock.mock.calls.some((c) => ((c as unknown[])[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('shows the roster with warnings, matches names, changes a day, and switches the rota on', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    let state = overview();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body = JSON.parse(String(init!.body));
        calls.push({ url, method, body });
        if (url.endsWith('/match')) { state = overview({ teachers: [row({ personId: 'p1', memberName: 'Alpha Tester', language: 'en' })], warnings: [] }); return json({ result: { matched: 1, ambiguous: [], notFound: [] }, overview: state }); }
        if (url.endsWith('/settings')) { state = { ...state, settings: { ...state.settings!, enabled: true } }; return json(state); }
        return json(overview({ teachers: [row({ dayOfWeek: body.dayOfWeek ?? 1 })] }));
      }
      return json(state);
    }));
    vi.stubGlobal('confirm', () => true);
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    expect(screen.getByTestId('rota-status')).toHaveTextContent('OFF');
    expect(screen.getByTestId('rota-status')).toHaveTextContent('not matched to a member yet');
    expect(screen.getByTestId('teacher-row')).toHaveTextContent('Not matched to a member yet');

    fireEvent.click(screen.getByText('Match names to members'));
    await screen.findByTestId('match-result');
    expect(screen.getByTestId('match-result')).toHaveTextContent('1 matched.');
    expect(screen.getByTestId('teacher-row')).toHaveTextContent('✓ Alpha Tester');

    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '3' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body.dayOfWeek === 3)).toBe(true));

    fireEvent.click(screen.getByTestId('rota-switch'));
    await waitFor(() => expect(screen.getByTestId('rota-status')).toHaveTextContent('ON'));
    expect(calls.find((c) => c.url.endsWith('/settings'))!.body).toEqual({ enabled: true });
  });

  it('asks for the French to be read first, and shows the server’s reason when switching on is refused', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { calls.push(JSON.parse(String(init.body))); return json({ error: 'A French-speaking teacher is on the list. Read the French and tick "French checked" first.', code: 'FRENCH_NOT_CHECKED' }, 409); }
      return json(overview({ frenchNeeded: true, warnings: [] }));
    }));
    vi.stubGlobal('confirm', () => true);
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    expect(screen.getByLabelText(/I have read the French/)).not.toBeChecked();
    fireEvent.click(screen.getByTestId('rota-switch'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Read the French');
  });

  it('lets the admin read a teaching in French or English before switching on', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/topics/1')) return json({ number: 1, kind: 'key', en: text('Key 9, Prayer'), fr: { ...text('Clé 9, la prière'), teachingOn: 'Clé 9, la prière.' } });
      return json(overview());
    }));
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    fireEvent.click(screen.getByText(/1\. Key 9, Prayer/));
    expect(await screen.findByText('Clé 9, la prière.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('🇬🇧 English'));
    expect(await screen.findByText('Key 9, Prayer.')).toBeInTheDocument();
  });
});


const COUNTS = { EXCELLENT: 2, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 1 };
const CARD = { teacherName: 'Alpha Tester', topic: 'Key 9, Prayer', total: 3, counts: COUNTS, myLevel: null, coordinator: null, isOwnTeaching: false, canRate: true };

describe('The rating card in the group', () => {
  it('invites a member to listen and rate, saves the chosen level, and lets it be changed', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      posts.push(body);
      return json({ ok: true, card: { ...CARD, myLevel: body.level, counts: { ...COUNTS, [body.level]: COUNTS[body.level as keyof typeof COUNTS] + 1 }, total: 4 } });
    }));
    render(<TeachingRatingCard messageId="m1" initial={CARD} />);
    const card = screen.getByTestId('rating-card-m1');
    expect(card).toHaveTextContent('Alpha Tester has finished teaching Key 9, Prayer.');
    expect(card).toHaveTextContent('Listen to the teaching, then rate it.');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Excellent', 'Very good', 'Good', 'Keep growing']);
    expect(card).toHaveTextContent('3 people have rated');
    fireEvent.click(screen.getByRole('button', { name: 'Very good' }));
    await screen.findByText('✓ You chose Very good');
    expect(screen.getByRole('button', { name: 'Very good' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Excellent' }));
    await screen.findByText('✓ You chose Excellent');
    expect(screen.getByRole('button', { name: 'Very good' })).toHaveAttribute('aria-pressed', 'false');
    expect(posts).toEqual([{ messageId: 'm1', level: 'VERY_GOOD' }, { messageId: 'm1', level: 'EXCELLENT' }]);
  });

  it('shows only totals per level (no names), and the Coordinator’s own rating to everyone', () => {
    render(<TeachingRatingCard messageId="m2" initial={{ ...CARD, coordinator: { name: 'Stanley Ndoh', level: 'EXCELLENT' } }} />);
    const card = screen.getByTestId('rating-card-m2');
    expect(card).toHaveTextContent('2 × Excellent');
    expect(card).toHaveTextContent('1 × Keep growing');
    expect(screen.getByTestId('coordinator-rating')).toHaveTextContent('Stanley Ndoh: Excellent');
  });

  it('says nobody has rated yet, and gives the teacher no rating buttons for their own teaching', () => {
    render(<TeachingRatingCard messageId="m3" initial={{ ...CARD, total: 0, counts: { EXCELLENT: 0, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 0 }, isOwnTeaching: true, canRate: false }} />);
    const card = screen.getByTestId('rating-card-m3');
    expect(card).toHaveTextContent('Nobody has rated yet.');
    expect(card).toHaveTextContent('This is your teaching. Others can rate it.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the server’s reason when a rating is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'You cannot rate the teachings.' }, 403)));
    render(<TeachingRatingCard messageId="m4" initial={CARD} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot rate the teachings.');
  });
});

describe('"I have finished my teaching" in the group', () => {
  it('shows for the teacher when it is their time, posts the card with one tap, then disappears', async () => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(url); return json({ posted: true }); }
      return json({ available: true, topic: 'Key 9, Prayer' });
    }));
    const onPosted = vi.fn();
    render(<TeachingFinishButton communityId="g1" onPosted={onPosted} />);
    const button = await screen.findByRole('button', { name: /I have finished my teaching/ });
    expect(screen.getByText('Key 9, Prayer')).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(posts).toEqual(['/api/member/teaching-rota/finish']);
    expect(screen.queryByTestId('finish-teaching')).toBeNull();
  });

  it('shows nothing to anyone else', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ available: false })));
    render(<TeachingFinishButton communityId="g1" onPosted={() => {}} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('finish-teaching')).toBeNull();
  });
});

describe('Results and the strip', () => {
  it('shows a teacher only totals of how they were rated on their page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(view({ results: [{ weekStart: '2026-11-16', topic: 'Key 8, The Word', total: 3, average: 3, counts: COUNTS }] }))));
    page();
    const card = await screen.findByTestId('teaching-results');
    expect(card).toHaveTextContent('Key 8, The Word');
    expect(card).toHaveTextContent('2 × Excellent');
    expect(card).toHaveTextContent('1 × Keep growing');
    expect(card).toHaveTextContent("Nobody's name is shown");
  });

  it('does not put rating on the Chats page: a member who is not a teacher sees no strip', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ enabled: true, isTeacher: false })));
    render(<MemoryRouter><TeachingStrip /></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('teaching-strip')).toBeNull();
  });
});

describe('Weekly teaching panel: ratings, who rates and sending', () => {
  const rated = row({ id: 't1', personId: 'p1', memberName: 'Alpha Tester', language: 'en', ratings: { total: 3, average: 3.3, counts: { EXCELLENT: 2, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 1 } } });
  const setup = (over: Record<string, unknown> = {}, calls: { url: string; method: string; body: any }[] = []) => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') { calls.push({ url, method, body: JSON.parse(String(init!.body)) }); return json(url.endsWith('/send-assignments') ? { sent: 2, alreadySent: 1, sentTo: ['Alpha Tester', 'Beta Tester'], passed: ['Gamma Tester'], notMatched: ['Delta Tester'], overview: overview({ settings: { enabled: true, startDate: '2026-11-23', frenchChecked: true, started: false }, teachers: [{ ...rated, assignment: { sentAt: '2026-11-22T17:00:00.000Z', messageSent: true, conversationId: 'c9', seen: true, replied: false } }], warnings: [] }) } : overview({ settings: { enabled: true, startDate: '2026-11-23', frenchChecked: true, started: false }, teachers: [rated], warnings: [], ...over })); }
      if (url.includes('/ratings/t1')) return json({ name: 'Alpha Tester', weeks: [{ weekStart: '2026-11-23', topic: 'Key 9, Prayer', total: 3, average: 3.3, counts: { EXCELLENT: 2, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 1 }, raters: [{ name: 'Rater One', level: 'EXCELLENT' }, { name: 'Rater Two', level: 'KEEP_GROWING' }] }] });
      if (url.includes('/groups')) return json({ items: [{ id: 'g1', name: 'Leadership Development group', kind: 'GROUP' }] });
      return json(overview({ settings: { enabled: true, startDate: '2026-11-23', frenchChecked: true, started: false }, teachers: [rated], warnings: [], ...over }));
    }));
  };

  it('shows each leader’s average and who gave which rating', async () => {
    setup();
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    expect(screen.getByTestId('rating-line')).toHaveTextContent('⭐ 3.3');
    expect(screen.getByTestId('rating-line')).toHaveTextContent('3 ratings');
    fireEvent.click(screen.getByText('See ratings'));
    const detail = await screen.findByTestId('rating-detail');
    expect(detail).toHaveTextContent('Rater One: Excellent');
    expect(detail).toHaveTextContent('Rater Two: Keep growing');
  });

  it('lets the admin choose the group whose members rate', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    setup({ raters: { communityId: 'g1', communityName: 'Leadership Development group', count: 12 } }, calls);
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    expect(screen.getByTestId('raters-box')).toHaveTextContent('Teachings are rated in Leadership Development group (12 people can rate).');
    fireEvent.click(screen.getByText('Choose the group'));
    fireEvent.change(screen.getByLabelText("Type the group's name"), { target: { value: 'leader' } });
    fireEvent.click(await screen.findByTestId('group-result'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/settings'))?.body).toEqual({ ratersCommunityId: 'g1' }));
  });

  it('asks before sending, then says who got a private message, who did not and why, and shows where each one went', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    setup({}, calls);
    const confirmFn = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmFn);
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    fireEvent.click(screen.getByTestId('send-now'));
    const note = await screen.findByTestId('rota-note');
    expect(note).toHaveTextContent('Sent to 2 teachers (1 already had it).');
    expect(note).toHaveTextContent('Sent as a private message to: Alpha Tester, Beta Tester');
    expect(note).toHaveTextContent('their time this week has already passed: Gamma Tester');
    expect(note).toHaveTextContent('not matched to a member yet: Delta Tester');
    expect(note).toHaveTextContent('in your Chats');
    // and each name now shows where its assignment went
    expect(screen.getByTestId('assignment-status')).toHaveTextContent('opened');
    expect(confirmFn).toHaveBeenCalledWith(expect.stringContaining('private message from you'));
    expect(calls.map((c) => c.url)).toEqual(['/api/admin/teaching-rota/send-assignments']);
    // declining sends nothing
    confirmFn.mockReturnValue(false);
    fireEvent.click(screen.getByTestId('send-now'));
    expect(calls).toHaveLength(1);
  });

  it('lists the best rated first when asked', async () => {
    setup({ teachers: [row({ id: 't2', name: 'Low Rated', ratings: { total: 2, average: 2, counts: { EXCELLENT: 0, VERY_GOOD: 0, GOOD: 2, KEEP_GROWING: 0 } } }), rated] });
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    expect(screen.getAllByTestId('teacher-row')[0]).toHaveTextContent('Low Rated');
    fireEvent.click(screen.getByLabelText('Best rated first'));
    expect(screen.getAllByTestId('teacher-row')[0]).toHaveTextContent('Alpha Tester');
  });
});


describe('Choosing a member for a name', () => {
  it('shows a member without an app account greyed out with the reason, and lets the others be chosen', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') { calls.push({ url, method, body: JSON.parse(String(init!.body)) }); return json(overview({ teachers: [row({ personId: 'p2', memberName: 'Zora Mbeki Ndlovu' })] })); }
      if (url.includes('/members')) return json({ items: [{ id: 'p2', name: 'Zora Mbeki Ndlovu', language: 'en', hasAccount: true, takenBy: null }, { id: 'p3', name: 'Mbeki Ndlovu (old)', language: 'en', hasAccount: false, takenBy: null }] });
      return json(overview());
    }));
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    fireEvent.click(screen.getByText('Choose member'));
    fireEvent.change(screen.getByLabelText("Type the member's name"), { target: { value: 'mbeki' } });
    const results = await screen.findAllByTestId('member-result');
    expect(results).toHaveLength(2);
    expect(results[1]).toHaveAttribute('aria-disabled', 'true');
    expect(results[1]).toHaveTextContent('no app account yet');
    fireEvent.click(results[1]);
    expect(screen.getByTestId('member-hint')).toHaveTextContent('has not created an app account yet');
    expect(calls).toHaveLength(0);
    fireEvent.click(results[0]);
    await waitFor(() => expect(calls[0]?.body).toEqual({ personId: 'p2' }));
  });
});

describe('Editing the teachings', () => {
  const TOPIC = { number: 1, kind: 'key', en: text('The Key of Prayer'), fr: { ...text('La Clé de la prière'), help: 'La prière est plus que demander.' } };
  const mock = (calls: { url: string; method: string; body: any }[], fail = false) =>
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        calls.push({ url, method, body: JSON.parse(String(init!.body)) });
        return fail ? json({ error: 'Please fill in every field (en help).' }, 400) : json({ topic: TOPIC, overview: overview({ topics: [{ number: 1, kind: 'key', title: 'The Key of Prayer (new)', hasFrench: true }] }) });
      }
      if (url.includes('/topics/1')) return json(TOPIC);
      return json(overview());
    }));

  async function openEditor() {
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    fireEvent.click(screen.getByText(/1\. Key 9, Prayer/));
    fireEvent.click(await screen.findByTestId('edit-topic-1'));
    return screen.findByTestId('topic-editor');
  }

  it('opens the saved words in the editor, saves a change in both languages, and shows the new title', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    mock(calls);
    const editor = await openEditor();
    const help = screen.getByLabelText('Help us understand') as HTMLTextAreaElement;
    expect(help.value).toBe('Prayer is more than asking.');
    fireEvent.change(help, { target: { value: 'Prayer is talking with our Father.' } });
    fireEvent.click(screen.getByRole('button', { name: /Français/, pressed: false }));
    expect((screen.getByLabelText('Help us understand') as HTMLTextAreaElement).value).toBe('La prière est plus que demander.');
    fireEvent.click(screen.getByTestId('topic-save'));
    await screen.findByText(/Teaching saved/);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('/api/admin/teaching-rota/topics/1');
    expect(calls[0].body.en.help).toBe('Prayer is talking with our Father.');
    expect(calls[0].body.fr.help).toBe('La prière est plus que demander.');
    expect(calls[0].body.en.verses).toEqual(['Matthew 7:7', 'Philippians 4:6']);
    expect(editor).not.toBeInTheDocument();
    expect(screen.getByText(/1\. The Key of Prayer \(new\)/)).toBeInTheDocument();
  });

  it('will not save an English field left empty, and sends nothing', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    mock(calls);
    await openEditor();
    fireEvent.change(screen.getByLabelText('What it means'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('topic-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please fill in every English field.');
    expect(calls).toHaveLength(0);
  });

  it('asks for every French field or none, and removes the French when all are emptied', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    mock(calls);
    const editor = await openEditor();
    fireEvent.click(within(editor).getByRole('button', { name: /Français/ }));
    fireEvent.change(screen.getByLabelText('Help us understand'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('topic-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fill in every French field, or leave them all empty.');
    expect(calls).toHaveLength(0);
    for (const label of ['Name of the teaching (for example: The Key of Faith)', 'Book (for example: Kingdom Keys, Volume 4)', 'Chapter (for example: Chapter 21: The Key of Faith)', 'You will be teaching us on', 'What it means', 'Words above the story (for example: Start with this story)', 'The story or picture', 'Words above the next part (for example: If we do not use this Key)', 'If we do not know this', 'How this gives us dominion', 'Verses (separated by commas)']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    }
    fireEvent.click(screen.getByTestId('topic-save'));
    await screen.findByText(/Teaching saved/);
    expect(calls[0].body.fr).toBeNull();
  });

  it('adds a new teaching with every English field filled, and shows the server’s reason when it is refused', async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    mock(calls, true);
    render(<TeachingRotaPanel base="/api/admin/teaching-rota" />);
    await screen.findByText('Alpha Tester');
    fireEvent.click(screen.getByTestId('add-topic'));
    await screen.findByTestId('topic-editor');
    for (const label of ['Name of the teaching (for example: The Key of Faith)', 'Book (for example: Kingdom Keys, Volume 4)', 'Chapter (for example: Chapter 21: The Key of Faith)', 'You will be teaching us on', 'Help us understand', 'What it means', 'Words above the story (for example: Start with this story)', 'The story or picture', 'Words above the next part (for example: If we do not use this Key)', 'If we do not know this', 'How this gives us dominion']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'x' } });
    }
    fireEvent.change(screen.getByLabelText('Verses (separated by commas)'), { target: { value: 'John 1:1; John 3:16' } });
    fireEvent.click(screen.getByRole('button', { name: 'A Right' }));
    fireEvent.click(screen.getByTestId('topic-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please fill in every field');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('/api/admin/teaching-rota/topics');
    expect(calls[0].body).toMatchObject({ kind: 'right', fr: null });
    expect(calls[0].body.en.verses).toEqual(['John 1:1', 'John 3:16']);
  });
});

describe('Seeing a teacher’s own page', () => {
  it('shows the central admin exactly what the teacher sees, and nothing for an unmatched name', async () => {
    const week = { weekStart: '2026-11-23', isCurrent: true, startsAt: '2026-11-23T06:00:00.000Z', endsAt: '2026-11-23T06:15:00.000Z', status: 'upcoming', kind: 'key', text: { topic: 'The Right to Forgiveness', bookTitle: 'Book', chapter: 'Chapter 1', teachingOn: 'On this', help: 'Help', meaning: 'Meaning', startLabel: 'Start with this', start: 'Start', ifNotLabel: 'If not', ifNot: 'If not', dominion: 'Dominion', verses: ['John 1:1'] }, textLanguage: 'en', book: null };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/teachers/t1/page')) return json({ enabled: true, isTeacher: true, language: 'en', started: true, startsOn: '2026-11-23', minutes: 15, weeks: [week] });
      return json(overview({ teachers: [row({ personId: 'p1', memberName: 'Alpha Tester', language: 'en' }), row({ id: 't2', name: 'Beta Tester' })], warnings: [] }));
    }));
    render(<MemoryRouter><TeachingRotaPanel base="/api/admin/teaching-rota" /></MemoryRouter>);
    await screen.findByText('Alpha Tester');
    expect(screen.getAllByTestId('see-page')).toHaveLength(1); // only the matched name has a page
    fireEvent.click(screen.getByTestId('see-page'));
    const preview = await screen.findByTestId('teacher-page-preview');
    expect(preview).toHaveTextContent('This is what Alpha Tester sees on My teaching');
    expect(preview).toHaveTextContent('The Right to Forgiveness');
  });
});

describe('The “how it works” message', () => {
  it('asks first, then says how many teachers got it', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') { calls.push({ url, method }); return json({ sent: 18, alreadySent: 1, sentTo: ['Alpha Tester'], notMatched: [] }); }
      return json(overview({ settings: { enabled: true, startDate: '2026-11-23', frenchChecked: true, started: false }, teachers: [row({ personId: 'p1', memberName: 'Alpha Tester', language: 'en' })], warnings: [] }));
    }));
    const confirmFn = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmFn);
    render(<MemoryRouter><TeachingRotaPanel base="/api/admin/teaching-rota" /></MemoryRouter>);
    await screen.findByText('Alpha Tester');
    fireEvent.click(screen.getByTestId('send-howto'));
    expect(await screen.findByTestId('rota-note')).toHaveTextContent('“How it works” sent to 18 teachers (1 already had it).');
    expect(confirmFn).toHaveBeenCalledWith(expect.stringContaining('private message from you'));
    expect(calls).toEqual([{ url: '/api/admin/teaching-rota/send-howto', method: 'POST' }]);
    confirmFn.mockReturnValue(false);
    fireEvent.click(screen.getByTestId('send-howto'));
    expect(calls).toHaveLength(1); // declining sends nothing
  });
});

