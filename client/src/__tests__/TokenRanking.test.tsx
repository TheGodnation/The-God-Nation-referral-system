import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberTokenRankingPage } from '../pages/MemberTokenRankingPage';
import { MemberTokensPage } from '../pages/MemberTokensPage';

// The ranking of members by all the tokens earned by studying: name and total only.
function mockFetch(handlers: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      return Promise.resolve({ ok: Boolean(key), status: key ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => (key ? handlers[key] : {}) });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.removeItem('godnation:store-app');
});

const ranking = {
  count: 3,
  items: [
    { rank: 1, name: 'Student Lea', total: 12.5, isMe: false },
    { rank: 1, name: 'Student Joe', total: 12.5, isMe: false },
    { rank: 3, name: 'Student Sam', total: 1, isMe: true },
  ],
  me: { rank: 3, name: 'Student Sam', total: 1, isMe: true },
};

describe('the ranking page', () => {
  it('lists members from the most tokens to the fewest, shares a rank for the same total, and marks the member', async () => {
    mockFetch({ '/api/member/tokens/ranking': ranking });
    render(<MemoryRouter><MemberTokenRankingPage /></MemoryRouter>);
    const rows = await screen.findAllByTestId('ranking-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Student Lea')).toBeInTheDocument();
    expect(within(rows[0]).getByText('12.5 tokens')).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText('Rank 1')).toBeInTheDocument();
    expect(within(rows[2]).getByText('1 token')).toBeInTheDocument();
    expect(within(rows[2]).getByText('You')).toBeInTheDocument();
    expect(screen.getByTestId('ranking-me')).toHaveTextContent('You are number 3');
  });

  it('tells a member with no tokens yet how to get into the list', async () => {
    mockFetch({ '/api/member/tokens/ranking': { ...ranking, items: ranking.items.slice(0, 2), count: 2, me: null } });
    render(<MemoryRouter><MemberTokenRankingPage /></MemoryRouter>);
    expect(await screen.findByTestId('ranking-me')).toHaveTextContent('Take a quiz to earn your first tokens');
  });

  it('says "points" in the Play Store version', async () => {
    sessionStorage.setItem('godnation:store-app', '1');
    mockFetch({ '/api/member/tokens/ranking': ranking });
    render(<MemoryRouter><MemberTokenRankingPage /></MemoryRouter>);
    expect(await screen.findAllByText('12.5 points')).toHaveLength(2);
    expect(screen.queryByText(/tokens/i)).toBeNull();
  });

  it('is one tap from the member\'s tokens page', async () => {
    mockFetch({
      '/api/member/tokens': { started: true, startsAt: '2026-11-15T00:00:00Z', usable: false, balance: { earned: 7, bought: 0, total: 7 }, foundation: { total: 3 }, clinicRate: 1, nextHalving: null, schedule: [], history: [] },
    });
    render(<MemoryRouter><MemberTokensPage /></MemoryRouter>);
    const link = await screen.findByTestId('ranking-link');
    expect(link).toHaveAttribute('href', '/member/tokens/ranking');
  });
});
