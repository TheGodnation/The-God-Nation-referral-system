import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AgentPicker } from '../components/learn/PayWithAgent';
import { MemberPaymentOrderPage } from '../pages/MemberPaymentOrderPage';
import { MemberPaymentDeskPage } from '../pages/MemberPaymentDeskPage';
import { PaymentDeskCard } from '../components/member/PaymentDeskCard';
import { PaymentAgentsAdmin } from '../components/admin/PaymentAgentsAdmin';
import { PayManyPanel } from '../components/learn/TrainingPayments';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// Paying for a book through a payment agent: choosing an agent who is online,
// the order chat (pay, send the transaction ID, screenshot), the agent
// confirming at the payment desk, and the admin's agent list.
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
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
  calls.length = 0;
});

const ME = { member: { name: 'Me', email: 'me@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'me' } };

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    role: 'BUYER',
    status: 'OPEN',
    amount: 1200,
    bookNumber: 1,
    bookTitleEn: 'The Leader Within',
    bookTitleFr: null,
    counterpart: { name: 'Aggie Agent', photoUrl: null, online: true, lastSeenAt: null, label: 'Douala office' },
    payment: null,
    canClaim: true,
    canCancel: true,
    canDecide: false,
    messages: [{ id: 'm1', mine: false, senderName: 'Aggie Agent', body: 'Send 1,200 FCFA to MTN 670 000 000.', auto: true, hasProof: false, createdAt: '2026-10-28T10:00:00Z' }],
    ...over,
  };
}

function renderOrder() {
  return render(
    <MemoryRouter initialEntries={['/member/payment-orders/o1']}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/payment-orders/:id" element={<MemberPaymentOrderPage />} />
          <Route path="/member/school" element={<div>The school</div>} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Choosing a payment agent', () => {
  it('lists agents with who is online, and opens an order with the one chosen', async () => {
    mockFetch({
      'GET /api/member/pay/agents': () => ({
        body: {
          items: [
            { id: 'a1', name: 'Aggie Agent', label: 'Douala office', photoUrl: null, online: true, lastSeenAt: null, busy: false },
            { id: 'a2', name: 'Bob Busy', label: null, photoUrl: null, online: true, lastSeenAt: null, busy: true },
          ],
          activeOrder: null,
        },
      }),
      'POST /api/member/pay/orders': () => ({ status: 201, body: { id: 'o1' } }),
    });
    render(
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route path="/x" element={<AgentPicker bookId="b1" />} />
          <Route path="/member/payment-orders/:id" element={<div>The order chat</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const picker = await screen.findByTestId('pay-agents');
    expect(within(picker).getByText('Aggie Agent')).toBeInTheDocument();
    expect(within(picker).getByText(/online · Douala office/)).toBeInTheDocument();
    const buttons = within(picker).getAllByRole('button', { name: 'Pay through them' });
    expect(buttons[1]).toBeDisabled(); // the busy one
    fireEvent.click(buttons[0]);
    expect(await screen.findByText('The order chat')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ agentId: 'a1', bookId: 'b1' });
  });

  it('shows nothing when the ministry has no agents', async () => {
    mockFetch({ 'GET /api/member/pay/agents': () => ({ body: { items: [], activeOrder: null } }) });
    render(
      <MemoryRouter>
        <AgentPicker bookId="b1" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('pay-agents')).not.toBeInTheDocument();
  });
});

describe('The payment order chat', () => {
  it('shows the agent\'s instructions, lets the member write, and sends "I have paid" with the transaction ID', async () => {
    let state = order();
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/pay/orders/o1': () => ({ body: state }),
      'POST /api/member/pay/orders/o1/messages': () => ({ status: 201, body: { id: 'm2' } }),
      'POST /api/member/pay/orders/o1/paid': () => {
        state = order({ status: 'CLAIMED', canClaim: false, canCancel: false, payment: { status: 'CLAIMED', reference: 'MP241028.1111.A11111', payerPhone: null, note: null } });
        return { status: 201, body: { id: 'p1', status: 'CLAIMED' } };
      },
    });
    renderOrder();
    expect(await screen.findByText('Send 1,200 FCFA to MTN 670 000 000.')).toBeInTheDocument();
    expect(screen.getByText('Aggie Agent')).toBeInTheDocument();
    expect(screen.getByText(/online · Douala office/)).toBeInTheDocument();
    expect(screen.getByText('1 200 FCFA')).toBeInTheDocument();
    expect(screen.getByTestId('order-status')).toHaveTextContent('Waiting for your payment');

    fireEvent.change(screen.getByLabelText('Write a message'), { target: { value: 'I am sending it now' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/messages'))?.body).toEqual({ body: 'I am sending it now' }));

    fireEvent.click(screen.getByRole('button', { name: /I have paid/ }));
    fireEvent.click(screen.getByRole('button', { name: 'I have paid' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please type the transaction ID');
    fireEvent.change(screen.getByLabelText('Mobile Money transaction ID'), { target: { value: 'MP241028.1111.A11111' } });
    fireEvent.click(screen.getByRole('button', { name: 'I have paid' }));
    expect(await screen.findByText(/The representative is checking that the money arrived/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/paid'))?.body).toEqual({ reference: 'MP241028.1111.A11111' });
    expect(screen.getByTestId('order-status')).toHaveTextContent('Being checked');
  });

  it('tells the member when the agent could not find the payment, and lets them send it again', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/pay/orders/o1': () => ({ body: order({ payment: { status: 'REJECTED', reference: 'X', payerPhone: null, note: 'The amount was 1,000.' } }) }),
    });
    renderOrder();
    expect(await screen.findByRole('status')).toHaveTextContent('The representative could not find your payment');
    expect(screen.getByRole('status')).toHaveTextContent('The amount was 1,000.');
    expect(screen.getByRole('button', { name: /I have paid/ })).toBeInTheDocument();
  });

  it('the agent sees the transaction ID and confirms or says it was not received', async () => {
    let state = order({
      role: 'AGENT',
      status: 'CLAIMED',
      canClaim: false,
      canCancel: false,
      canDecide: true,
      counterpart: { name: 'Ben Buyer', photoUrl: null, online: false, lastSeenAt: null, label: null },
      payment: { status: 'CLAIMED', reference: 'MP241028.1111.A11111', payerPhone: '+237 670 000 001', note: null },
    });
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/pay/orders/o1': () => ({ body: state }),
      'POST /api/member/pay/orders/o1/decide': (b) => {
        state = order({ ...state, status: b.decision === 'CONFIRM' ? 'CONFIRMED' : 'OPEN', canDecide: false });
        return { body: { status: b.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED' } };
      },
    });
    renderOrder();
    const box = await screen.findByTestId('decide-box');
    expect(within(box).getByText('MP241028.1111.A11111')).toBeInTheDocument();
    expect(within(box).getByText(/\+237 670 000 001/)).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: /Yes, I received it/ }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/decide'))?.body).toEqual({ decision: 'CONFIRM' }));
    expect(await screen.findByText('You confirmed this payment.')).toBeInTheDocument();
  });

  it('sending "not received" carries the agent\'s note', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/pay/orders/o1': () => ({ body: order({ role: 'AGENT', status: 'CLAIMED', canClaim: false, canDecide: true, payment: { status: 'CLAIMED', reference: 'ABC123', payerPhone: null, note: null } }) }),
      'POST /api/member/pay/orders/o1/decide': () => ({ body: { status: 'REJECTED' } }),
    });
    renderOrder();
    const box = await screen.findByTestId('decide-box');
    fireEvent.click(within(box).getByRole('button', { name: 'I did not receive it' }));
    fireEvent.change(within(box).getByLabelText('What is wrong? (optional)'), { target: { value: 'Wrong amount' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Send to the member' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/decide'))?.body).toEqual({ decision: 'REJECT', note: 'Wrong amount' }));
  });

  it('a confirmed order says the book is open and has no message box', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/pay/orders/o1': () => ({ body: order({ status: 'CONFIRMED', canClaim: false, canCancel: false }) }),
    });
    renderOrder();
    expect(await screen.findByText(/Payment confirmed. Your book is open/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Write a message')).not.toBeInTheDocument();
  });
});

describe('The payment desk', () => {
  it('lists the orders waiting for the agent and today\'s count', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/pay/desk': () => ({
        body: {
          dailyLimit: 20,
          confirmedToday: 3,
          waiting: [{ id: 'o1', status: 'CLAIMED', amount: 1200, bookNumber: 1, buyerName: 'Ben Buyer', buyerPhotoUrl: null, buyerOnline: true, updatedAt: '2026-10-28T10:00:00Z' }],
          recent: [],
        },
      }),
    });
    render(
      <MemoryRouter>
        <MemberAuthProvider>
          <MemberPaymentDeskPage />
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Ben Buyer')).toBeInTheDocument();
    expect(screen.getByText('Confirmed today: 3 of 20')).toBeInTheDocument();
    expect(screen.getByText('Check payment')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ben Buyer/ })).toHaveAttribute('href', '/member/payment-orders/o1');
  });

  it('the desk card shows only for agents', async () => {
    mockFetch({ 'GET /api/member/pay/me': () => ({ body: { isAgent: false, waiting: 0 } }) });
    const { unmount } = render(
      <MemoryRouter>
        <PaymentDeskCard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(calls.length).toBe(1));
    expect(screen.queryByText('Payment desk')).not.toBeInTheDocument();
    unmount();
    mockFetch({ 'GET /api/member/pay/me': () => ({ body: { isAgent: true, waiting: 2 } }) });
    render(
      <MemoryRouter>
        <PaymentDeskCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Payment desk')).toBeInTheDocument();
    expect(screen.getByText('2 orders waiting')).toBeInTheDocument();
  });
});

describe('Payment agents in the admin', () => {
  it('lists agents with their numbers and switches one off', async () => {
    mockFetch({
      'GET /api/admin/payment-agents': () => ({
        body: { items: [{ id: 'a1', personId: 'p1', name: 'Aggie Agent', whatsappNumber: '+237670000000', active: true, label: 'Douala office', dailyLimit: 20, instructions: null, online: true, confirmedToday: 2, confirmedTotal: 9, waiting: 1 }] },
      }),
      'GET /api/admin/payment-orders': () => ({ body: { items: [{ id: 'o1', status: 'CONFIRMED', amount: 1200, bookNumber: 1, buyerName: 'Ben Buyer', agentName: 'Aggie Agent', reference: 'MP1', proofs: 1, createdAt: '2026-10-28T10:00:00Z', decidedAt: null }] } }),
      'PATCH /api/admin/payment-agents/a1': () => ({ body: { ok: true } }),
    });
    render(<PaymentAgentsAdmin />);
    const card = await screen.findByTestId('agent-a1');
    expect(within(card).getByText(/Confirmed today: 2 · in total: 9 · waiting: 1/)).toBeInTheDocument();
    expect(await screen.findByText(/Ben Buyer/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ active: false }));
  });
});

describe('Paying for several books', () => {
  it('chooses how many books, shows the total, and sends one transaction ID for all of them', async () => {
    mockFetch({
      'GET /api/member/pay/agents': () => ({ body: { items: [], activeOrder: null } }),
      'POST /api/member/training/payments': () => ({ status: 201, body: { id: 'p1', status: 'CLAIMED', count: 5 } }),
    });
    const done = vi.fn();
    render(
      <MemoryRouter>
        <PayManyPanel price={1200} owedBooks={5} payable={15} instructions="Pay to MTN 670 000 000." onDone={done} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pay for several books' }));
    const panel = screen.getByTestId('pay-many');
    // What is owed is already chosen: 5 books = 6,000 FCFA.
    expect(within(panel).getByTestId('pay-many-total')).toHaveTextContent('5 books · 6 000 FCFA');
    fireEvent.click(within(panel).getByRole('button', { name: 'All 15 remaining' }));
    expect(within(panel).getByTestId('pay-many-total')).toHaveTextContent('15 books · 18 000 FCFA');
    fireEvent.change(within(panel).getByLabelText('How many books do you want to pay for?'), { target: { value: '7' } });
    expect(within(panel).getByTestId('pay-many-total')).toHaveTextContent('7 books · 8 400 FCFA');
    expect(within(panel).getByText('Pay to MTN 670 000 000.')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'I have paid' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Please type the transaction ID');
    fireEvent.change(within(panel).getByLabelText('Mobile Money transaction ID'), { target: { value: 'MP241028.7777.A77777' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'I have paid' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/member/training/payments')?.body).toEqual({ count: 7, reference: 'MP241028.7777.A77777' });
  });

  it('offers agents for the chosen number of books', async () => {
    mockFetch({
      'GET /api/member/pay/agents': () => ({ body: { items: [{ id: 'a1', name: 'Aggie Agent', label: null, photoUrl: null, online: true, lastSeenAt: null, busy: false }], activeOrder: null } }),
      'POST /api/member/pay/orders': () => ({ status: 201, body: { id: 'o1' } }),
    });
    render(
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route path="/x" element={<PayManyPanel price={1200} owedBooks={0} payable={4} instructions={null} onDone={() => {}} />} />
          <Route path="/member/payment-orders/:id" element={<div>The order chat</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pay for several books' }));
    fireEvent.change(screen.getByLabelText('How many books do you want to pay for?'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Pay through them' }));
    expect(await screen.findByText('The order chat')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ agentId: 'a1', count: 3 });
  });

  it('shows nothing when there is no book left to pay for', () => {
    mockFetch({});
    const { container } = render(
      <MemoryRouter>
        <PayManyPanel price={1200} owedBooks={0} payable={0} instructions={null} onDone={() => {}} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
