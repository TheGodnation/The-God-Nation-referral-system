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
  instructions: 'Send Mobile Money to 6xx xx xx xx.',
  minimum: 100,
  maximum: 10000000,
  campaigns: [{ id: 'c1', titleEn: 'Help Brother Paul', titleFr: 'Aidons le frère Paul', descriptionEn: 'Hospital bills', descriptionFr: null, targetAmount: 100000, raised: 50000, giftCount: 2 }],
  mine: [{ id: 'g1', kind: 'TITHE', campaignTitleEn: null, campaignTitleFr: null, amount: 20000, status: 'CONFIRMED', anonymous: false, createdAt: '2026-11-01T10:00:00Z' }],
};
const show = () => render(<MemoryRouter><MemberGivePage /></MemoryRouter>);

describe('MemberGivePage — what it says', () => {
  it('describes giving as weekly freewill offerings and others for the work in the media, with the call to help; no word about the central administration or leaders', async () => {
    mockFetch({ '/api/member/giving/info': () => ({ status: 200, body: info }) });
    const { container } = show();
    await screen.findByText(/Send Mobile Money to 6xx/);
    expect(screen.getByText(/Giving consists of weekly freewill offerings, and others given to support the work we are doing in reaching people with the Gospel through the media\./)).toBeInTheDocument();
    expect(screen.getByText('Help us penetrate the digital media space, make disciples and take the Gospel to the ends of the earth.')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/central administration/i);
    expect(text).not.toMatch(/straight to/i);
    expect(text).not.toMatch(/leaders do not see/i);
    expect(text).not.toMatch(/free-will gift and is never required/i);
  });

  it('says you give through the mobile money number made available there', async () => {
    mockFetch({ '/api/member/giving/info': () => ({ status: 200, body: info }) });
    show();
    expect(await screen.findByText('You give through the mobile money number made available here.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How to give' })).toBeInTheDocument();
  });

  it('has the button "Contact to Receive Confirmation", with what it is for', async () => {
    mockFetch({ '/api/member/giving/info': () => ({ status: 200, body: info }) });
    show();
    expect(await screen.findByRole('button', { name: 'Contact to Receive Confirmation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /central administration/i })).toBeNull();
    expect(screen.getByText(/confirm that your offering or contribution has been received/)).toBeInTheDocument();
  });

  it('lists the categories: offering, tithes, seed faith, thanksgiving offering, first fruits, the monthly freewill gift for the books, other gifts, then help one another', async () => {
    mockFetch({ '/api/member/giving/info': () => ({ status: 200, body: info }) });
    show();
    const select = (await screen.findByLabelText('What is it for?')) as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['OFFERING', 'Offering'],
      ['TITHE', 'Tithes'],
      ['SEED_FAITH', 'Seed Faith'],
      ['THANKSGIVING', 'Thanksgiving Offering'],
      ['FIRST_FRUITS', 'First Fruits'],
      ['FREE_WILL', 'Monthly Freewill Gift for Dominion Clinic Books'],
      ['OTHER', 'Other offerings and gifts'],
      ['CAMPAIGN', 'Help one another'],
    ]);
    fireEvent.change(select, { target: { value: 'FREE_WILL' } });
    expect(screen.getByText(/A monthly freewill gift towards the Dominion Clinic books/)).toBeInTheDocument();
  });

  it('sends a new category, such as Seed Faith', async () => {
    mockFetch({
      '/api/member/giving/gifts': () => ({ status: 201, body: { id: 'g9' } }),
      '/api/member/giving/info': () => ({ status: 200, body: info }),
    });
    show();
    fireEvent.change(await screen.findByLabelText('What is it for?'), { target: { value: 'SEED_FAITH' } });
    fireEvent.change(screen.getByLabelText('Amount (FCFA)'), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'MP555555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Contact to Receive Confirmation' }));
    await screen.findByText(/We will confirm that your gift has been received/);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ kind: 'SEED_FAITH', amount: 2000, reference: 'MP555555' });
  });

  it('is in French too', async () => {
    mockFetch({ '/api/member/giving/info': () => ({ status: 200, body: info }) });
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('fr');
    show();
    expect(await screen.findByRole('button', { name: 'Contacter pour recevoir la confirmation' })).toBeInTheDocument();
    expect(screen.getByText(/Donner, ce sont les offrandes volontaires de chaque semaine/)).toBeInTheDocument();
    const select = screen.getByLabelText('Pour quoi ?') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(expect.arrayContaining(['Dîmes', 'Semence de foi', 'Prémices', 'Autres offrandes et dons']));
    await i18n.changeLanguage('en');
  });
});

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
    fireEvent.click(screen.getByRole('button', { name: 'Contact to Receive Confirmation' }));
    expect(await screen.findByText('Thank you. We will confirm that your gift has been received and let you know.')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Contact to Receive Confirmation' }));
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
