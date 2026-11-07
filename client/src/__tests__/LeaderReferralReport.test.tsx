import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { LeaderReferralReportPanel } from '../components/admin/LeaderReferralReportPanel';

// The leaders' referral report from the first system: totals, one card per leader, search, test accounts, spreadsheet.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const row = (over: Record<string, unknown>) => ({ leaderId: 'l1', name: 'Anna', email: 'anna@x.org', active: true, codes: ['ANNA1'], visits: 50, uniqueVisitors: 20, referred: 12, tappedGroup: 9, inApp: 7, inAssembly: 5, conversionRate: 60, firstReferralAt: '2026-01-05T00:00:00Z', lastReferralAt: '2026-10-20T00:00:00Z', ...over });
const REPORT = {
  rows: [row({}), row({ leaderId: 'l2', name: 'Ben Off', email: 'ben@x.org', active: false, codes: ['BEN2'], visits: 4, uniqueVisitors: 4, referred: 1, tappedGroup: 0, inApp: 0, inAssembly: 0, conversionRate: 25, firstReferralAt: null, lastReferralAt: null })],
  totals: { visits: 54, uniqueVisitors: 24, referred: 13, tappedGroup: 9, inApp: 7, inAssembly: 5, conversionRate: 54.17 },
};

describe('Leaders\' referral report', () => {
  it('shows the totals and each leader with the numbers, and marks a leader who is turned off', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(url); return json(REPORT); }));
    render(<LeaderReferralReportPanel base="/api/member/central-leader-referral-report" />);
    const totals = await screen.findByTestId('referral-totals');
    expect(totals).toHaveTextContent('All 2 leaders together');
    expect(totals).toHaveTextContent('13');
    expect(totals).toHaveTextContent('54.17%');
    const anna = screen.getByTestId('referral-row-l1');
    expect(anna).toHaveTextContent('Anna');
    expect(anna).toHaveTextContent('ANNA1');
    expect(within(anna).getByText('Signed up').previousSibling).toHaveTextContent('12');
    expect(within(anna).getByText('Tapped join group').previousSibling).toHaveTextContent('9');
    expect(within(anna).getByText('Now in the app').previousSibling).toHaveTextContent('7');
    expect(anna).toHaveTextContent('20 different visitors');
    expect(screen.getByTestId('referral-row-l2')).toHaveTextContent('Turned off');
    expect(urls[0]).toBe('/api/member/central-leader-referral-report/?includeTestData=false');
  });

  it('searches by name, asks again with test accounts, and offers the spreadsheet', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(url); return json(REPORT); }));
    render(<LeaderReferralReportPanel base="/api/admin/leader-referral-report" />);
    await screen.findByTestId('referral-totals');
    fireEvent.change(screen.getByPlaceholderText('Find a leader…'), { target: { value: 'ben' } });
    expect(screen.queryByTestId('referral-row-l1')).not.toBeInTheDocument();
    expect(screen.getByTestId('referral-row-l2')).toBeInTheDocument();
    expect(screen.getByTestId('referral-export')).toHaveAttribute('href', '/api/admin/leader-referral-report/export?includeTestData=false');
    fireEvent.click(screen.getByLabelText('Include test accounts'));
    await waitFor(() => expect(urls.some((u) => u.endsWith('includeTestData=true'))).toBe(true));
    expect(await screen.findByText(/does not tell the app who actually joined/)).toBeInTheDocument();
  });
});
