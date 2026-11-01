import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberTokensPage } from '../pages/MemberTokensPage';
import { MemberClinicPage } from '../pages/MemberClinicPage';
import { TokensCard } from '../components/admin/TokensCard';

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
