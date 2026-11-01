import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberGivePage } from '../pages/MemberGivePage';

// "Give": how to give, saying "I have given", help-one-another campaigns with
// their public report (Anonymous givers shown as such), and my own gifts.
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

const info = {
  instructions: 'Send Mobile Money to 6xx xx xx xx (Central Administration).',
  minimum: 100,
  maximum: 10000000,
  campaigns: [{ id: 'c1', titleEn: 'Help Brother Paul', titleFr: 'Aidons le frère Paul', descriptionEn: 'Hospital bills', descriptionFr: null, targetAmount: 100000, raised: 50000, giftCount: 2 }],
  mine: [{ id: 'g1', kind: 'TITHE', campaignTitleEn: null, campaignTitleFr: null, amount: 20000, status: 'CONFIRMED', anonymous: false, createdAt: '2026-11-01T10:00:00Z' }],
};
const show = () => render(<MemoryRouter><MemberGivePage /></MemoryRouter>);

describe('MemberGivePage', () => {
  it('shows how to give, the campaigns and my gifts with their status', async () => {
    mockFetch({ '/api/member/giving/info': () => ({ status: 200, body: info }) });
    show();
    expect(await screen.findByText(/Send Mobile Money to 6xx/)).toBeInTheDocument();
    expect(screen.getByText('Help Brother Paul')).toBeInTheDocument();
    expect(screen.getByText('Received, thank you')).toBeInTheDocument();
    expect(screen.getByText(/never listed publicly/)).toBeInTheDocument();
  });

  it('says "I have given": an offering with its amount and transaction ID', async () => {
    mockFetch({
      '/api/member/giving/gifts': () => ({ status: 201, body: { id: 'g9' } }),
      '/api/member/giving/info': () => ({ status: 200, body: info }),
    });
    show();
    fireEvent.change(await screen.findByLabelText('Amount (FCFA)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'MP123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tell the central administration' }));
    expect(await screen.findByText('Thank you. We will confirm your gift and let you know.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ kind: 'OFFERING', amount: 5000, reference: 'MP123456' });
  });

  it('gives to a campaign and can ask to appear as Anonymous', async () => {
    mockFetch({
      '/api/member/giving/gifts': () => ({ status: 201, body: { id: 'g9' } }),
      '/api/member/giving/info': () => ({ status: 200, body: info }),
    });
    show();
    fireEvent.change(await screen.findByLabelText('What is it for?'), { target: { value: 'CAMPAIGN' } });
    fireEvent.change(screen.getByLabelText('Which campaign?'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByLabelText('Show me as Anonymous in the public report'));
    fireEvent.change(screen.getByLabelText('Amount (FCFA)'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'MP777777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tell the central administration' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ kind: 'CAMPAIGN', campaignId: 'c1', anonymous: true, amount: 10000, reference: 'MP777777' });
  });

  it('opens a campaign report: names, and Anonymous for those who asked', async () => {
    mockFetch({
      '/api/member/giving/campaigns/c1/report': () => ({
        status: 200,
        body: { campaign: info.campaigns[0], gifts: [{ id: 'a', name: 'Open Olivia', amount: 20000, date: '2026-11-01' }, { id: 'b', name: null, amount: 30000, date: '2026-11-02' }] },
      }),
      '/api/member/giving/info': () => ({ status: 200, body: info }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'See who gave' }));
    expect(await screen.findByText('Open Olivia')).toBeInTheDocument();
    expect(screen.getByText('Anonymous', { selector: 'span' })).toBeInTheDocument();
  });
});
