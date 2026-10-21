import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberSchoolPage } from '../pages/MemberSchoolPage';
import { MemberSchoolBookPage } from '../pages/MemberSchoolBookPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// Paying for leadership books in the Leadership School: "I have paid" with
// the Mobile Money transaction ID (on the book's page), what is owed, why a
// book is closed, and asking to study now and pay later.
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
const book = (n: number, over: Record<string, unknown> = {}) => ({
  id: `b${n}`,
  trainingOrder: n,
  titleEn: `Book title ${n}`,
  titleFr: null,
  descriptionEn: null,
  descriptionFr: null,
  coverUrl: null,
  unlocked: false,
  canRead: false,
  payment: null,
  lockedBecause: 'PREVIOUS_EXAM',
  exam: null,
  ...over,
});

function summary(training: Record<string, unknown>) {
  return {
    enrollment: 'ACTIVE',
    price: 1100,
    owed: { books: 1, amount: 1100 },
    graceBooks: 0,
    maxGraceBooks: 5,
    graceRequest: null,
    paymentInstructionsEn: 'Pay to MTN 6 70 00 00 00 (God Nation Ministry).',
    paymentInstructionsFr: null,
    automaticPayments: false,
    books: [] as any[],
    ...training,
  };
}

/** The school's routes: the school page and each book's page from the same summary. */
function schoolRoutes(get: () => ReturnType<typeof summary>) {
  return {
    'GET /api/member/auth/me': () => ({ body: ME }),
    'GET /api/member/school': () => ({ body: get() }),
    'GET /api/member/school/books/': () => ({ body: { ...get(), book: get().books.find((b: any) => calls[calls.length - 1].url.endsWith(`/${b.id}`)), chapters: [] } }),
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/school" element={<MemberSchoolPage />} />
          <Route path="/member/school/:bookId" element={<MemberSchoolBookPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Paying for leadership books', () => {
  it('shows what is owed and why the next book is closed', async () => {
    const data = summary({ books: [book(1, { unlocked: true, canRead: true, lockedBecause: null }), book(2, { lockedBecause: 'PAYMENT' })] });
    mockFetch(schoolRoutes(() => data));
    renderAt('/member/school');
    expect(await screen.findByText(/To pay: 1\s100 FCFA \(1 book\)/)).toBeInTheDocument();
    cleanupAndRender('/member/school/b2');
    expect(await screen.findByText('Opens when Book 1 is paid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay 1\s100 FCFA/ })).not.toBeInTheDocument();
  });

  it('sends "I have paid" with the transaction ID from the book\'s page', async () => {
    let paid = false;
    mockFetch({
      ...schoolRoutes(() => summary({ books: [book(1, { unlocked: true, canRead: true, lockedBecause: null, payment: paid ? 'CLAIMED' : null })] })),
      'POST /api/member/training/books/b1/payments': () => {
        paid = true;
        return { status: 201, body: { id: 'p1', status: 'CLAIMED' } };
      },
    });
    renderAt('/member/school/b1');
    fireEvent.click(await screen.findByRole('button', { name: /Pay 1\s100 FCFA/ }));
    const panel = screen.getByTestId('pay-book-1');
    expect(within(panel).getByText('Pay to MTN 6 70 00 00 00 (God Nation Ministry).')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Pay now with Mobile Money' })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'I have paid' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Please type the transaction ID');

    fireEvent.change(within(panel).getByLabelText('Mobile Money transaction ID'), { target: { value: 'MP241021.1234.A56789' } });
    fireEvent.change(within(panel).getByLabelText('Number you paid from (optional)'), { target: { value: '+237 670 000 001' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'I have paid' }));
    expect(await screen.findByText('Payment sent — waiting for confirmation')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/payments'))?.body).toEqual({ reference: 'MP241021.1234.A56789', payerPhone: '+237 670 000 001' });
  });

  it('offers "Pay now" when paying in the app is switched on', async () => {
    mockFetch({
      ...schoolRoutes(() => summary({ automaticPayments: true, books: [book(1, { unlocked: true, canRead: true, lockedBecause: null })] })),
      'POST /api/member/training/books/b1/pay-now': () => ({ status: 201, body: { id: 'p2', status: 'PENDING' } }),
    });
    renderAt('/member/school/b1');
    fireEvent.click(await screen.findByRole('button', { name: /Pay 1\s100 FCFA/ }));
    const panel = screen.getByTestId('pay-book-1');
    fireEvent.change(within(panel).getByLabelText('Number you paid from (optional)'), { target: { value: '+237670000001' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Pay now with Mobile Money' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/pay-now'))?.body).toEqual({ phone: '+237670000001' }));
  });

  it('asks to study now and pay later, for a chosen number of books', async () => {
    let asked = false;
    mockFetch({
      ...schoolRoutes(() => summary({ graceRequest: asked ? { status: 'REQUESTED', books: 3 } : null, books: [book(1, { unlocked: true, canRead: true, lockedBecause: null })] })),
      'POST /api/member/training/grace': () => {
        asked = true;
        return { status: 201, body: { status: 'REQUESTED', books: 3 } };
      },
    });
    renderAt('/member/school');
    fireEvent.click(await screen.findByRole('button', { name: 'Study now, pay later' }));
    fireEvent.change(screen.getByLabelText('How many books would you like to read before paying?'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send my request' }));
    expect(await screen.findByText('Your request to study 3 books before paying was sent to the central admin.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/training/grace'))?.body).toEqual({ books: 3 });
  });

  it('says when all open books are paid, and when grace is granted', async () => {
    const data = summary({ owed: { books: 0, amount: 0 }, graceBooks: 2, books: [book(1, { unlocked: true, canRead: true, lockedBecause: null, payment: 'PAID' })] });
    mockFetch(schoolRoutes(() => data));
    renderAt('/member/school');
    expect(await screen.findByText('✓ All your open books are paid. Thank you!')).toBeInTheDocument();
    expect(screen.getByText('Grace granted: you may owe up to 2 books before paying.')).toBeInTheDocument();
    cleanupAndRender('/member/school/b1');
    expect(await screen.findByText(/✓ Paid/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay 1\s100 FCFA/ })).not.toBeInTheDocument();
  });
});

function cleanupAndRender(path: string) {
  cleanup();
  renderAt(path);
}
