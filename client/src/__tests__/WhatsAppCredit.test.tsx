import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WhatsAppCredit } from '../components/admin/WhatsAppCredit';
import { BookStatusLines, type SchoolBook } from '../components/learn/schoolBits';

const calls: { url: string; method: string; body: any }[] = [];
let credited = 2;

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      let res: unknown = {};
      if (url.startsWith('/api/admin/people')) res = { items: [{ id: 'p1', name: 'Marie Ngono', whatsappNumber: '+237600000001' }] };
      else if (url === '/api/admin/library/trainees/p1/credit' && method === 'GET')
        res = { personId: 'p1', name: 'Marie Ngono', whatsappNumber: '+237600000001', enrolled: true, booksCredited: credited, totalBooks: 16, booksOnSite: 15, passedByExam: 0 };
      else if (url === '/api/admin/library/trainees/p1/credit' && method === 'POST') res = { booksCredited: body.books, notified: body.notify };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => res };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
  credited = 2;
});

async function choosePerson() {
  fireEvent.change(screen.getByPlaceholderText(/Search a person/), { target: { value: 'Marie' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('option', { name: /Marie Ngono \(\+237600000001\)/ });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
  await screen.findByTestId('credit-input');
}

describe('Books already done on WhatsApp (admin)', () => {
  it('finds a person, shows what is recorded, saves the new number and tells them', async () => {
    mockFetch();
    render(<WhatsAppCredit />);
    await choosePerson();
    expect(screen.getByTestId('credit-now')).toHaveTextContent('Recorded now: 2 books');
    fireEvent.change(screen.getByTestId('credit-input'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('credit-save'));
    await screen.findByText(/Marie Ngono now has 9 books counted as done/);
    expect(screen.getByText(/They were told by message/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ books: 9, notify: true });
  });

  it('refuses a number above the programme, and asks before lowering one', async () => {
    mockFetch();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WhatsAppCredit />);
    await choosePerson();
    fireEvent.change(screen.getByTestId('credit-input'), { target: { value: '17' } });
    fireEvent.click(screen.getByTestId('credit-save'));
    expect(await screen.findByText(/whole number from 0 to 16/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByTestId('credit-input'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('credit-save'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('A book completed on WhatsApp (student)', () => {
  it('says so, without an invented score or a "Paid" line', () => {
    const book = {
      id: 'b1',
      trainingOrder: 1,
      titleEn: 'Book 1',
      titleFr: null,
      unlocked: true,
      canRead: true,
      payment: 'PAID',
      credited: true,
      exam: { id: 'e1', passMark: 70, bestPercentage: null, passed: true },
    } as SchoolBook;
    render(<BookStatusLines book={book} />);
    expect(screen.getByText(/Completed on WhatsApp/)).toBeInTheDocument();
    expect(screen.queryByText(/Passed with/)).toBeNull();
    expect(screen.queryByText(/Paid/)).toBeNull();
  });
});
