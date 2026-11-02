import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberTokensPage } from '../pages/MemberTokensPage';
import { MemberClinicPage } from '../pages/MemberClinicPage';
import { TokensCard } from '../components/admin/TokensCard';
import { PayBookPanel } from '../components/learn/TrainingPayments';

// King's Tokens: the member's balance page, the tokens shown in the Dominion
// Clinic results, and the central admin's "Start counting" card.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(handlers: Record<string, (init?: RequestInit) => unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      return Promise.resolve({ ok: Boolean(key), status: key ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => (key ? handlers[key](init) : {}) });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

const schedule = [
  { fromYear: 1, toYear: 4, clinic: 8, book: 16 },
  { fromYear: 5, toYear: 8, clinic: 4, book: 8 },
  { fromYear: 9, toYear: 12, clinic: 2, book: 4 },
  { fromYear: 13, toYear: null, clinic: 1, book: 2 },
];
const started = {
  started: true,
  startsAt: '2026-11-15T00:00:00Z',
  usable: false,
  balance: { earned: 56, bought: 0, total: 56 },
  foundation: { total: 24 },
  clinicRate: 8,
  nextHalving: { at: '2030-11-15T00:00:00Z', rate: 4 },
  schedule,
  history: [
    { id: 'h1', at: '2026-11-20T10:00:00Z', reason: 'CLINIC_EXAM', kind: 'EARNED', amount: 56, correctAnswers: 7, ratePerAnswer: 8, examNumber: 1, monthTitleEn: 'November', monthTitleFr: 'Novembre' },
  ],
};

describe('MemberTokensPage', () => {
  it('shows the balance, that it cannot be used yet, the rate now with the next halving, the history and the foundation', async () => {
    mockFetch({ '/api/member/tokens': () => started });
    render(<MemoryRouter><MemberTokensPage /></MemoryRouter>);
    const balance = await screen.findByTestId('tokens-balance');
    expect(balance).toHaveTextContent('56');
    expect(balance).toHaveTextContent('You cannot use them yet');
    expect(screen.getByTestId('tokens-rate')).toHaveTextContent('each correct answer in a Dominion Clinic exam earns 8 tokens');
    expect(screen.getByTestId('tokens-rate')).toHaveTextContent('it halves to 4');
    expect(screen.getByTestId('tokens-rate')).toHaveTextContent('Year 13 and after, for ever');
    expect(screen.getByTestId('tokens-history')).toHaveTextContent('Dominion Clinic, exam 1 (November): 7 correct × 8');
    expect(screen.getByTestId('tokens-history')).toHaveTextContent('+56');
    expect(screen.getByTestId('tokens-foundation')).toHaveTextContent('The foundation holds 24 tokens');
  });

  it('says how tokens are earned, and what they will be used for: Bible study tools, a share of materials, helping one another', async () => {
    mockFetch({ '/api/member/tokens': () => started });
    render(<MemoryRouter><MemberTokensPage /></MemoryRouter>);
    expect(await screen.findByText("You earn King's Tokens by answering Dominion Clinic examination questions correctly. They are kept for you, and you will be told when and how to use them.")).toBeInTheDocument();
    const uses = screen.getByTestId('tokens-uses');
    expect(uses).toHaveTextContent('What they will be used for');
    expect(uses).toHaveTextContent('They will be used to access tools that will be made available to the community, especially Bible study tools. These will include all the concordances and different versions of the Bible, making it easy for anybody to study the Bible. These tools will be made available within the community.');
    expect(uses).toHaveTextContent('The tokens might also be used to purchase a percentage of certain materials that will be made available.');
    expect(uses).toHaveTextContent('They might equally be used to help one another within the community when the time comes.');
  });

  it('says tokens have not started counting yet, with the start day', async () => {
    mockFetch({ '/api/member/tokens': () => ({ ...started, started: false, startsAt: '2099-01-02T00:00:00Z', clinicRate: null, nextHalving: null, balance: { earned: 0, bought: 0, total: 0 }, history: [] }) });
    render(<MemoryRouter><MemberTokensPage /></MemoryRouter>);
    expect(await screen.findByText('Tokens have not started counting yet.')).toBeInTheDocument();
    expect(screen.getByText(/They start counting on/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing yet\. Take a Dominion Clinic exam/)).toBeInTheDocument();
  });

  it('is in French too', async () => {
    mockFetch({ '/api/member/tokens': () => started });
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('fr');
    render(<MemoryRouter><MemberTokensPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: /Jetons du Roi/ })).toBeInTheDocument();
    expect(screen.getByTestId('tokens-history')).toHaveTextContent('Clinique de la Domination, examen 1 (Novembre)');
    await i18n.changeLanguage('en');
  });
});

describe('Dominion Clinic results show the tokens an exam earned', () => {
  it('shows tokens under the score', async () => {
    mockFetch({
      '/api/member/clinic': () => ({
        rhythm: { examEveryDays: 10, examQuestions: 10, topicRhythm: 'DAILY' },
        exams: [{ assessmentId: 'a1', number: 1, monthTitleEn: 'November', monthTitleFr: null, opensAt: '2026-11-01T00:00:00Z', open: true, score: 7, maxScore: 10, percentage: 70, passed: true, takenAt: '2026-11-03T00:00:00Z', tokens: 56 }],
        total: { exams: 1, score: 7, maxScore: 10 },
      }),
    });
    render(<MemoryRouter><MemberClinicPage /></MemoryRouter>);
    expect(await screen.findByText(/56 tokens earned/)).toBeInTheDocument();
  });
});

describe('TokensCard (central admin)', () => {
  const notStarted = { started: false, startsAt: null, clinicRate: null, earnedTotal: 0, foundationTotal: 0, members: 0 };

  it('starts counting now after a confirmation, then shows the totals and no more buttons', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch({
      '/api/admin/tokens/summary': () => notStarted,
      '/api/admin/tokens/start': () => ({ ...notStarted, started: true, startsAt: '2026-11-15T00:00:00Z', clinicRate: 8 }),
    });
    render(<TokensCard base="/api/admin/tokens" />);
    expect(await screen.findByText('Not started yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start counting now' }));
    expect(await screen.findByText('Tokens are counting.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ now: true });
    expect(screen.getByText(/Now: 8 tokens per correct answer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start counting now' })).not.toBeInTheDocument();
  });

  it('does not start when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockFetch({ '/api/admin/tokens/summary': () => notStarted });
    render(<TokensCard base="/api/admin/tokens" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start counting now' }));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('works from the central admin\'s own member profile too, on its own address', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch({
      '/api/member/central-tokens/summary': () => notStarted,
      '/api/member/central-tokens/start': () => ({ ...notStarted, started: true, startsAt: '2026-11-15T00:00:00Z', clinicRate: 8 }),
    });
    render(<TokensCard base="/api/member/central-tokens" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start counting now' }));
    expect(await screen.findByText('Tokens are counting.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/api/member/central-tokens/start'))).toBe(true);
  });

  it('chooses a day and saves it', async () => {
    mockFetch({
      '/api/admin/tokens/summary': () => notStarted,
      '/api/admin/tokens/start': (init) => ({ ...notStarted, startsAt: `${JSON.parse(init!.body as string).date}T00:00:00.000Z` }),
    });
    render(<TokensCard base="/api/admin/tokens" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set this day' }));
    expect(await screen.findByText('Choose a day.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Or choose the day'), { target: { value: '2099-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set this day' }));
    expect(await screen.findByText('The start day is saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ date: '2099-03-01' });
    expect(screen.getByText(/Starts on/)).toBeInTheDocument();
  });
});

const quote = { enabled: true, price: 1200, count: 1, balance: 500, perBookCap: 360, maxTokens: 360, maxFrancs: 360, valueFcfa: 1, maxPercent: 30 };

describe('paying a book with tokens', () => {
  async function openPanel() {
    render(
      <MemoryRouter>
        <PayBookPanel bookId="b1" bookNumber={1} price={1200} instructions="Pay to MTN 670" automatic={false} onDone={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
  }

  it('offers the tokens when spending is on, says what the member then pays, and sends useTokens with the claim', async () => {
    mockFetch({
      '/api/member/tokens/spend-quote': () => quote,
      '/api/member/pay/agents': () => ({ items: [], activeOrder: null }),
      '/api/member/training/books/b1/payments': () => ({ id: 'p1', status: 'CLAIMED' }),
    });
    await openPanel();
    const box = await screen.findByTestId('use-tokens');
    expect(box).toHaveTextContent('360 tokens take 360 FCFA off');
    expect(box).toHaveTextContent('Tokens can pay up to 30% of the price');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(box).toHaveTextContent('You then pay 840 FCFA');
    fireEvent.change(screen.getByLabelText(/transaction ID/i), { target: { value: 'MP-123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'I have paid' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/books/b1/payments'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.includes('/books/b1/payments'))?.body).toMatchObject({ reference: 'MP-123456', useTokens: true });
  });

  it('shows nothing about tokens when spending is off or the member has none', async () => {
    mockFetch({
      '/api/member/tokens/spend-quote': () => ({ ...quote, enabled: false, maxTokens: 0, maxFrancs: 0 }),
      '/api/member/pay/agents': () => ({ items: [], activeOrder: null }),
    });
    await openPanel();
    await waitFor(() => expect(calls.some((c) => c.url.includes('spend-quote'))).toBe(true));
    expect(screen.queryByTestId('use-tokens')).not.toBeInTheDocument();
  });

  it('sends an ordinary claim, without useTokens, when the box is left unticked', async () => {
    mockFetch({
      '/api/member/tokens/spend-quote': () => quote,
      '/api/member/pay/agents': () => ({ items: [], activeOrder: null }),
      '/api/member/training/books/b1/payments': () => ({ id: 'p1', status: 'CLAIMED' }),
    });
    await openPanel();
    await screen.findByTestId('use-tokens');
    fireEvent.change(screen.getByLabelText(/transaction ID/i), { target: { value: 'MP-654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'I have paid' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/books/b1/payments'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.includes('/books/b1/payments'))?.body).not.toHaveProperty('useTokens');
  });
});

describe('the member tokens page with spending', () => {
  it('says tokens can be used toward a book once spending is on, and lists a spend in the history', async () => {
    mockFetch({
      '/api/member/tokens': () => ({
        ...started,
        usable: true,
        spend: { enabled: true, valueFcfa: 1, maxPercent: 30 },
        balance: { earned: 140, bought: 0, total: 140 },
        history: [
          { id: 'h2', at: '2026-12-01T10:00:00Z', reason: 'SPEND_HOLD', kind: 'EARNED', amount: -360, correctAnswers: null, ratePerAnswer: null, examNumber: null, monthTitleEn: null, monthTitleFr: null, bookNumber: 1 },
          ...started.history.map((h) => ({ ...h, bookNumber: null })),
        ],
      }),
    });
    render(<MemoryRouter><MemberTokensPage /></MemoryRouter>);
    expect(await screen.findByText(/You can use tokens toward a book when you pay for it: up to 30%/)).toBeInTheDocument();
    expect(screen.getByTestId('tokens-history')).toHaveTextContent('Used toward Book 1');
    expect(screen.getByTestId('tokens-history')).toHaveTextContent('-360');
  });
});

describe('TokensCard spending controls', () => {
  const base = { started: true, startsAt: '2026-11-15T00:00:00Z', clinicRate: 8, earnedTotal: 100, foundationTotal: 43, members: 2, burnedTotal: 0, spentTotal: 0, spend: { enabled: false, valueFcfa: 1, maxPercent: 30 } };

  it('switches spending on after a confirmation and saves the rate and limit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch({
      '/api/admin/tokens/summary': () => base,
      '/api/admin/tokens/spend-settings': (init) => ({ ...base, spend: JSON.parse(init!.body as string) }),
    });
    render(<TokensCard base="/api/admin/tokens" />);
    fireEvent.click(await screen.findByLabelText('Members can use tokens toward books'));
    fireEvent.change(screen.getByLabelText('Francs one token takes off'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Most of a price tokens can pay (%)'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save spending settings' }));
    expect(await screen.findByText('Spending settings saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true, valueFcfa: 2, maxPercent: 40 });
  });

  it('does not switch spending on when the confirmation is declined, and refuses a bad value', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockFetch({ '/api/admin/tokens/summary': () => base });
    render(<TokensCard base="/api/admin/tokens" />);
    fireEvent.click(await screen.findByLabelText('Members can use tokens toward books'));
    fireEvent.click(screen.getByRole('button', { name: 'Save spending settings' }));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.change(screen.getByLabelText('Francs one token takes off'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save spending settings' }));
    expect(await screen.findByText('Enter more than 0 francs, and a limit from 1 to 100.')).toBeInTheDocument();
  });

  it('shows how much was used on books and burned', async () => {
    mockFetch({ '/api/admin/tokens/summary': () => ({ ...base, spentTotal: 360, burnedTotal: 180, spend: { enabled: true, valueFcfa: 1, maxPercent: 30 } }) });
    render(<TokensCard base="/api/admin/tokens" />);
    const box = await screen.findByTestId('tokens-spend');
    expect(box).toHaveTextContent('Tokens used on books');
    expect(box).toHaveTextContent('360');
    expect(box).toHaveTextContent('180');
  });
});
