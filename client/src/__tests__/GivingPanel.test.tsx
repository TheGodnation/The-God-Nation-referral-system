import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GivingPanel } from '../components/admin/GivingPanel';

// The central admin's giving desk (admin dashboard and his own member profile).
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(handlers: Record<string, () => { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      const res = key ? handlers[key]() : { status: 404, body: { error: 'nope' } };
      return Promise.resolve({ ok: res.status < 300, status: res.status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const B = '/api/admin/giving';
const base = {
  [`${B}/summary`]: () => ({ status: 200, body: { confirmedTotal: 15000, confirmedCount: 2, waitingCount: 1, byKind: [{ kind: 'OFFERING', total: 5000, count: 1 }, { kind: 'TITHE', total: 10000, count: 1 }, { kind: 'FREE_WILL', total: 0, count: 0 }, { kind: 'CAMPAIGN', total: 0, count: 0 }], byAssembly: [{ communityId: 'a', name: 'Assembly A', total: 15000, count: 2 }] } }),
  [`${B}/waiting`]: () => ({ status: 200, body: { items: [{ id: 'g1', giverName: 'Giver Grace', assemblyName: 'Assembly A', kind: 'CAMPAIGN', campaignTitle: 'Help Brother Paul', amount: 4000, reference: 'MP1', payerPhone: '+237600000001', anonymous: true, createdAt: '2026-11-01T10:00:00Z' }] } }),
  [`${B}/campaigns`]: () => ({ status: 200, body: { items: [{ id: 'c1', titleEn: 'Help Brother Paul', titleFr: null, targetAmount: 100000, status: 'OPEN', raised: 50000, giftCount: 2 }] } }),
  [`${B}/instructions`]: () => ({ status: 200, body: { en: 'Pay to 6xx', fr: '', weeklyPost: true } }),
};

describe('GivingPanel', () => {
  it('shows the totals, per assembly, and what waits for confirmation (who, how much, transaction ID)', async () => {
    mockFetch(base);
    render(<GivingPanel base="/api/admin/giving" />);
    expect(await screen.findByText(/Received so far: .*15.000.*FCFA \(2 gifts\)/)).toBeInTheDocument();
    expect(screen.getByText('Assembly A')).toBeInTheDocument();
    expect(screen.getByText(/Giver Grace · /)).toBeInTheDocument();
    expect(screen.getByText(/wants to be Anonymous/)).toBeInTheDocument();
    expect(screen.getByText('Transaction ID: MP1', { exact: false })).toBeInTheDocument();
  });

  it('confirms a gift', async () => {
    mockFetch({ ...base, [`${B}/gifts/g1/decide`]: () => ({ status: 200, body: { status: 'CONFIRMED' } }) });
    render(<GivingPanel base="/api/admin/giving" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Confirmed. The giver has been thanked.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'CONFIRM' });
  });

  it('starts a campaign and saves how to give', async () => {
    mockFetch({
      ...base,
      [`${B}/campaigns`]: () => ({ status: 200, body: { items: [] } }),
      [`${B}/instructions`]: () => ({ status: 200, body: { en: 'Pay to 6xx', fr: '', weeklyPost: true } }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        const route = Object.keys(base).find((k) => url.endsWith(k.replace(B, '')) || url.includes(k));
        const body = method === 'GET' ? (route ? (base as any)[route]().body : {}) : { id: 'new' };
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
      }),
    );
    render(<GivingPanel base="/api/admin/giving" />);
    fireEvent.change(await screen.findByLabelText('Title (English)'), { target: { value: 'Help the widows' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start the campaign' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/campaigns'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/campaigns'))?.body).toEqual({ titleEn: 'Help the widows' });

    fireEvent.change(screen.getByLabelText('In French'), { target: { value: 'Payer au 6xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ en: 'Pay to 6xx', fr: 'Payer au 6xx', weeklyPost: true });
  });
});
