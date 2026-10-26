import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberEarningsPage } from '../pages/MemberEarningsPage';
import { ReferralPayoutsAdmin } from '../components/admin/ReferralPayoutsAdmin';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
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

const base = {
  settings: { commission: 500, holdDays: 3, minimum: 5000 },
  summary: { waiting: 500, available: 1500, paidOut: 0, inRequest: 0, total: 2000 },
  canRequestPayout: false,
  items: [
    { id: 'e1', buyerFirstName: 'Ben', bookNumber: 1, amount: 500, createdAt: '2026-10-20T10:00:00Z', availableAt: '2099-01-01T00:00:00Z', state: 'WAITING' },
    { id: 'e2', buyerFirstName: 'Ada', bookNumber: 2, amount: 500, createdAt: '2026-10-10T10:00:00Z', availableAt: '2026-10-13T10:00:00Z', state: 'AVAILABLE' },
  ],
  payouts: [],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <MemberEarningsPage />
    </MemoryRouter>,
  );

describe('My earnings', () => {
  it('explains the rule, shows the balances and each earning with the buyer\'s first name', async () => {
    mockFetch({ 'GET /api/member/earnings': () => ({ body: base }) });
    renderPage();
    expect(await screen.findByText(/you earn 500 FCFA/)).toBeInTheDocument();
    expect(screen.getByText(/counts after 3 days/)).toBeInTheDocument();
    expect(screen.getByTestId('balance-available')).toHaveTextContent('1 500 FCFA');
    expect(screen.getByTestId('balance-waiting')).toHaveTextContent('500 FCFA');
    expect(screen.getByText(/Ben · Book 1/)).toBeInTheDocument();
    expect(screen.getByText(/Ada · Book 2/)).toBeInTheDocument();
    expect(screen.getAllByText('Waiting')).toHaveLength(2); // the balance card and Ben's earning
    // Below the minimum: how much is still needed, and no payout form.
    expect(screen.getByText(/3 500 FCFA more and you can ask for a payout/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request payout' })).toBeNull();
  });

  it('shows a friendly empty state', async () => {
    mockFetch({ 'GET /api/member/earnings': () => ({ body: { ...base, summary: { waiting: 0, available: 0, paidOut: 0, inRequest: 0, total: 0 }, items: [] } }) });
    renderPage();
    expect(await screen.findByText(/Invite someone with your ambassador link/)).toBeInTheDocument();
  });

  it('lets the member request a payout once the minimum is reached', async () => {
    let asked = false;
    mockFetch({
      'GET /api/member/earnings': () => ({
        body: asked
          ? { ...base, canRequestPayout: false, summary: { ...base.summary, available: 0, inRequest: 5000 }, payouts: [{ id: 'p1', amount: 5000, phone: '+237670000111', status: 'REQUESTED', requestedAt: '2026-10-26T10:00:00Z', decidedAt: null, reference: null }] }
          : { ...base, canRequestPayout: true, summary: { ...base.summary, available: 5000 } },
      }),
      'POST /api/member/earnings/payout': () => {
        asked = true;
        return { status: 201, body: { id: 'p1', amount: 5000, status: 'REQUESTED' } };
      },
    });
    renderPage();
    const send = await screen.findByRole('button', { name: 'Request payout' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mobile Money number'), { target: { value: '+237 670 000 111' } });
    fireEvent.change(screen.getByLabelText('Name on that account'), { target: { value: 'Grace Ngwa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request payout' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ phone: '+237 670 000 111', payeeName: 'Grace Ngwa' }));
    expect(await screen.findByText(/Your request for 5 000 FCFA is being processed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request payout' })).toBeNull();
  });

  it('lets the member withdraw a waiting request', async () => {
    mockFetch({
      'GET /api/member/earnings': () => ({
        body: { ...base, summary: { ...base.summary, available: 0, inRequest: 5000 }, payouts: [{ id: 'p1', amount: 5000, phone: '+237670000111', status: 'REQUESTED', requestedAt: '2026-10-26T10:00:00Z', decidedAt: null, reference: null }] },
      }),
      'DELETE /api/member/earnings/payout/p1': () => ({ body: { ok: true } }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw this request' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/payout/p1'))).toBe(true));
  });
});

describe('Referral payouts (admin)', () => {
  const adminRoutes = (extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) => ({
    'GET /api/admin/payouts': () => ({
      body: { items: [{ id: 'p1', amount: 5000, phone: '+237670000111', payeeName: 'Grace Ngwa', requestedAt: '2026-10-26T10:00:00Z', person: { id: 'x', name: 'Grace Ngwa', whatsappNumber: '+237670000111' }, _count: { earnings: 10 } }] },
    }),
    'GET /api/admin/referral-earnings/settings': () => ({ body: { referralCommission: 500, commissionHoldDays: 3, payoutMinimum: 5000 } }),
    'GET /api/admin/referral-earnings': () => ({
      body: {
        totals: { waiting: 500, available: 1000, inRequest: 5000, paidOut: 0 },
        items: [{ id: 'e1', amount: 500, bookNumber: 1, status: 'ACTIVE', availableAt: '2099-01-01T00:00:00Z', createdAt: '2026-10-20T10:00:00Z', referrer: { id: 'r', name: 'Referrer Rita' }, buyer: { id: 'b', name: 'Buyer Ben' }, payout: null }],
      },
    }),
    ...extra,
  });

  it('shows what is owed, the requests to send, and marks one paid with the transaction ID', async () => {
    mockFetch(adminRoutes({ 'PATCH /api/admin/payouts/p1/paid': () => ({ body: { id: 'p1', status: 'PAID' } }) }));
    vi.spyOn(window, 'prompt').mockReturnValue('MP-SENT-1');
    render(<ReferralPayoutsAdmin />);
    expect(await screen.findByText('Grace Ngwa — 5 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText(/Send to \+237670000111 \(Grace Ngwa\)/)).toBeInTheDocument();
    expect(screen.getByText('1 000 FCFA')).toBeInTheDocument(); // available to pay
    expect(screen.getByText(/Referrer Rita ← Buyer Ben/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as paid' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/payouts/p1/paid'))?.body).toEqual({ reference: 'MP-SENT-1' }));
  });

  it('rejects a request with a note, and saves new amounts', async () => {
    mockFetch(
      adminRoutes({
        'PATCH /api/admin/payouts/p1/reject': () => ({ body: { id: 'p1', status: 'REJECTED' } }),
        'PATCH /api/admin/referral-earnings/settings': () => ({ body: {} }),
      }),
    );
    vi.spyOn(window, 'prompt').mockReturnValue('Number not valid');
    render(<ReferralPayoutsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/reject'))?.body).toEqual({ note: 'Number not valid' }));

    fireEvent.change(await screen.findByLabelText('Earned per book (FCFA)'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save amounts' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/settings'))?.body).toEqual({ referralCommission: 600, commissionHoldDays: 3, payoutMinimum: 5000 }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
});
