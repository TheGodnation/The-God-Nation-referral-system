import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstructionsPanel } from '../components/admin/InstructionsPanel';
import { LeaderInstructions } from '../components/leader/LeaderInstructions';
import { LeadershipDashboardBody } from '../components/leader/LeadershipDashboardBody';
import { AuthProvider } from '../lib/AuthContext';
import { pickText } from '../lib/instructionText';

// The National Coordinator writes an instruction (to everyone, chosen generations, or chosen leaders) and follows it
// up; a leader reads it, it is marked Seen, and they mark it Done with a note.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const LEADERS = [
  { personId: 'p1', name: 'Leader HQ', generations: [0], assemblies: ['Headquarters'] },
  { personId: 'p2', name: 'Leader A', generations: [1], assemblies: ['Assembly A'] },
  { personId: 'p3', name: 'Leader B', generations: [2], assemblies: ['Assembly B'] },
];

describe('pickText', () => {
  it('shows the reader\'s own language, and the original when there is no translation', () => {
    expect(pickText('en', 'en', 'Hello', 'Bonjour')).toBe('Hello');
    expect(pickText('fr', 'en', 'Hello', 'Bonjour')).toBe('Bonjour');
    expect(pickText('fr', 'en', 'Hello', null)).toBe('Hello');
    expect(pickText('fr-FR', 'fr', 'Bonjour', 'Hello')).toBe('Bonjour');
    expect(pickText('en', null, 'Hi', 'Salut')).toBe('Hi');
  });
});

describe('The National Coordinator\'s instructions desk', () => {
  it('counts who an instruction will reach, and sends it to chosen generations', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return json({ id: 'i1', recipients: 2 }, 201); }
      if (url.endsWith('/leaders')) return json({ leaders: LEADERS, generations: [0, 1, 2] });
      return json({ items: [] });
    }));
    render(<InstructionsPanel base="/api/admin/instructions" />);
    fireEvent.click(await screen.findByTestId('instruction-new'));
    expect(await screen.findByTestId('instruction-count')).toHaveTextContent('It will go to 3 leader(s).');

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Contact your people' } });
    fireEvent.change(screen.getByLabelText(/The instruction/), { target: { value: 'Every one this week.' } });
    fireEvent.click(screen.getByLabelText('The leaders of chosen generations'));
    expect(screen.getByTestId('instruction-count')).toHaveTextContent('It will go to 0 leader(s).');
    expect(screen.getByTestId('instruction-send')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Generation 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generation 2' }));
    expect(screen.getByTestId('instruction-count')).toHaveTextContent('It will go to 2 leader(s).');

    fireEvent.click(screen.getByTestId('instruction-send'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ title: 'Contact your people', audience: 'GENERATIONS', generations: [1, 2], personIds: [], repliesVisible: false });
  });

  it('sends to hand-picked leaders', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return json({ id: 'i1', recipients: 1 }, 201); }
      if (url.endsWith('/leaders')) return json({ leaders: LEADERS, generations: [0, 1, 2] });
      return json({ items: [] });
    }));
    render(<InstructionsPanel base="/api/admin/instructions" />);
    fireEvent.click(await screen.findByTestId('instruction-new'));
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText(/The instruction/), { target: { value: 'B' } });
    fireEvent.click(screen.getByLabelText('Leaders I choose'));
    fireEvent.change(screen.getByPlaceholderText('Find a leader…'), { target: { value: 'assembly b' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Leader B/ }));
    expect(screen.getByTestId('instruction-count')).toHaveTextContent('It will go to 1 leader(s).');
    fireEvent.click(screen.getByTestId('instruction-send'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ audience: 'PICKED', personIds: ['p3'] });
  });

  it('shows who is done, seen and late, and reminds those who have not finished', async () => {
    let reminded = false;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/i1/remind') && init?.method === 'POST') { reminded = true; return json({ reminded: 2 }); }
      if (url.endsWith('/i1')) return json({ id: 'i1', title: 'Contact your people', body: 'Every one this week.', language: 'en', titleTr: null, bodyTr: null, dueAt: null, repliesVisible: false, recipients: [
        { personId: 'p1', name: 'Leader HQ', status: 'DONE', seenAt: 'x', doneAt: 'x', note: 'All 12 contacted' },
        { personId: 'p2', name: 'Leader A', status: 'LATE', seenAt: 'x', doneAt: null, note: null },
        { personId: 'p3', name: 'Leader B', status: 'WAITING', seenAt: null, doneAt: null, note: null },
      ] });
      if (url.endsWith('/leaders')) return json({ leaders: LEADERS, generations: [0, 1, 2] });
      return json({ items: [{ id: 'i1', title: 'Contact your people', titleTr: null, language: 'en', audience: 'ALL_LEADERS', generations: [], dueAt: null, createdAt: '2026-11-06T10:00:00Z', total: 3, seen: 2, done: 1, late: 1 }] });
    }));
    render(<InstructionsPanel base="/api/admin/instructions" />);
    const row = await screen.findByTestId('instruction-row-i1');
    expect(row).toHaveTextContent('1 of 3 done');
    expect(row).toHaveTextContent('1 late');
    fireEvent.click(row);
    const tracker = await screen.findByTestId('instruction-tracker');
    expect(within(tracker).getByText('Leader HQ').closest('li')).toHaveTextContent('Done');
    expect(within(tracker).getByText('Leader A').closest('li')).toHaveTextContent('Late');
    expect(within(tracker).getByText('Leader B').closest('li')).toHaveTextContent('Not seen');
    expect(tracker).toHaveTextContent('All 12 contacted');
    fireEvent.click(screen.getByTestId('instruction-remind'));
    await waitFor(() => expect(reminded).toBe(true));
    expect(await screen.findByText('2 reminded.')).toBeInTheDocument();
  });
});

describe('A leader\'s instructions', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'i1', title: 'Contact your people', body: 'Every one this week.', language: 'en', titleTr: 'Contactez vos personnes', bodyTr: 'Chacun cette semaine.', dueAt: null, createdAt: '2026-11-06T10:00:00Z', status: 'WAITING', seenAt: null, doneAt: null, note: null, replies: [], ...over });

  it('marks an instruction Seen when it is opened, and Done with a note', async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { calls.push({ url, body: JSON.parse(String(init.body)) }); return json({ ok: true }); }
      return json({ items: [item()] });
    }));
    render(<LeaderInstructions />);
    fireEvent.click(await screen.findByTestId('leader-instruction-i1'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/i1/seen'))).toBe(true));
    fireEvent.change(await screen.findByPlaceholderText(/short note/), { target: { value: 'Done, 12 contacted' } });
    fireEvent.click(screen.getByTestId('instruction-done'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/i1/done'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/i1/done'))!.body).toEqual({ note: 'Done, 12 contacted' });
  });

  it('shows the instruction as it was written: headings, bold, bullets and numbered steps, not raw symbols', async () => {
    const body = '# Your first week\n\nGreetings, and *thank you* for saying yes.\n\n## What to do\n\n- Contact each person you look after\n- Send your weekly report\n\n1. Open the Leadership home\n2. Tap My people';
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (init?.method === 'POST' ? json({ ok: true }) : json({ items: [item({ id: 'f', body, bodyTr: null })] }))));
    render(<LeaderInstructions />);
    fireEvent.click(await screen.findByTestId('leader-instruction-f'));
    const text = await screen.findByTestId('instruction-body-f');
    expect(within(text).getByText('Your first week')).toBeInTheDocument();
    expect(within(text).getByText('What to do')).toBeInTheDocument();
    expect(text.querySelector('strong, b')?.textContent).toBe('thank you');
    expect(within(text).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Contact each person you look after', 'Send your weekly report', 'Open the Leadership home', 'Tap My people']);
    expect(text.textContent).not.toContain('# ');
    expect(text.textContent).not.toContain('*thank you*');
  });

  it('shows others\' notes when allowed, and puts finished instructions after the ones to do', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [
      item({ id: 'a', title: 'Old one', status: 'DONE', doneAt: 'x', seenAt: 'x' }),
      item({ id: 'b', title: 'New one', replies: [{ name: 'Leader A', note: 'Worked well', doneAt: 'x' }] }),
    ] })));
    render(<LeaderInstructions />);
    const list = await screen.findByTestId('leader-instructions');
    const titles = within(list).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles[0]).toContain('New one');
    expect(titles[1]).toContain('Old one');
    fireEvent.click(screen.getByTestId('leader-instruction-b'));
    expect(await screen.findByText(/Worked well/)).toBeInTheDocument();
  });

  it('shows a banner on the leader home when instructions are waiting, and opens them', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/auth/me')) return json({ user: { id: 'u1', name: 'Grace Etabu', email: 'g@x.org', role: 'LEADER', mustChangePassword: false, personId: 'p1' } });
      if (url.startsWith('/api/member/instructions')) return json({ items: [item(), item({ id: 'i2', status: 'DONE' })] });
      if (url.startsWith('/api/leader/my-people')) return json({ away: null, contactTarget: 2, items: [], total: 1, needingAttention: 0 });
      if (url.startsWith('/api/leader/role-assignments')) return json({ items: [] });
      if (url.startsWith('/api/leader/dashboard')) return json({ referralCode: 'G', stats: { conversionRate: 1 } });
      if (url.startsWith('/api/leader/links')) return json({ referralCode: 'G', links: null });
      if (url.startsWith('/api/leader/referrals')) return json({ items: [], pagination: { totalPages: 1 } });
      if (url.startsWith('/api/settings/public')) return json({ content: {} });
      return json({ items: [], viewer: { canPost: false, canModerate: false, personId: null }, nextBefore: null });
    }));
    render(
      <MemoryRouter initialEntries={['/member/leadership-dashboard']}>
        <AuthProvider>
          <LeadershipDashboardBody />
        </AuthProvider>
      </MemoryRouter>,
    );
    const banner = await screen.findByTestId('leader-instructions-banner');
    expect(banner).toHaveTextContent('1 instruction(s) waiting for you');
    fireEvent.click(banner);
    expect(await screen.findByTestId('leader-section-instructions')).toBeInTheDocument();
  });
});
