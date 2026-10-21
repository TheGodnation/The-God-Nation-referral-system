import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberSchoolPage } from '../pages/MemberSchoolPage';
import { MemberSchoolBookPage } from '../pages/MemberSchoolBookPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// God's Nation Leadership School: the 15 books as covers with their
// status, and each book's page with what it teaches chapter by chapter.
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
const exam = (id: string, over: Record<string, unknown> = {}) => ({ id, passMark: 70, bestPercentage: null, passed: false, tries: 0, canStart: true, block: null, ...over });
const BOOKS = [
  { id: 'b1', trainingOrder: 1, titleEn: 'Called to serve', titleFr: 'Appelé à servir', descriptionEn: null, descriptionFr: null, coverUrl: '/api/member/library/books/b1/cover?v=abc', pageCount: 84, chapterCount: 2, unlocked: true, canRead: true, payment: 'PAID', lockedBecause: null, exam: exam('e1', { bestPercentage: 90, passed: true }) },
  { id: 'b2', trainingOrder: 2, titleEn: 'Faithful in little', titleFr: null, descriptionEn: 'How small faithfulness grows.', descriptionFr: null, coverUrl: null, pageCount: null, chapterCount: 0, unlocked: true, canRead: true, payment: null, lockedBecause: null, exam: exam('e2') },
  { id: 'b3', trainingOrder: 3, titleEn: 'Leading with vision', titleFr: null, descriptionEn: null, descriptionFr: null, coverUrl: null, pageCount: null, chapterCount: 3, unlocked: false, canRead: false, payment: null, lockedBecause: 'PREVIOUS_EXAM', exam: null },
];
const SUMMARY = {
  enrollment: 'ACTIVE',
  price: 1100,
  owed: { books: 1, amount: 1100 },
  graceBooks: 0,
  maxGraceBooks: 5,
  graceRequest: null,
  paymentInstructionsEn: 'Pay to MTN 6 70 00 00 00.',
  paymentInstructionsFr: null,
  automaticPayments: false,
  books: BOOKS,
};

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

describe('Leadership School page', () => {
  it('shows all 15 books as covers with their status, and where to continue', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: ME }), 'GET /api/member/school': () => ({ body: SUMMARY }) });
    renderAt('/member/school');
    expect(await screen.findByRole('heading', { name: "God's Nation Leadership School" })).toBeInTheDocument();
    expect(screen.getByText('1 of 15 books passed')).toBeInTheDocument();
    expect(screen.getByText(/Take its exam: one try, 70% to pass/)).toBeInTheDocument();
    expect(screen.getByText(/Pay 1\s100 FCFA for the book/)).toBeInTheDocument();

    const books = within(screen.getByRole('heading', { name: 'The books' }).parentElement!).getAllByRole('listitem');
    expect(books).toHaveLength(15);
    expect(screen.getByRole('img', { name: 'Cover of Book 1: Called to serve' })).toHaveAttribute('src', '/api/member/library/books/b1/cover?v=abc');
    // No cover picture yet: a drawn cover with the title.
    expect(screen.getByRole('img', { name: 'Cover of Book 2: Faithful in little' }).tagName).toBe('DIV');
    expect(screen.getByRole('link', { name: 'Book 1: Called to serve — ✓ Passed' })).toHaveAttribute('href', '/member/school/b1');
    expect(screen.getByRole('link', { name: 'Book 2: Faithful in little — Open' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book 3: Leading with vision — 🔒 Locked' })).toBeInTheDocument();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(12);

    // Book 1 is passed and paid, so Book 2 is where to carry on.
    expect(screen.getByRole('link', { name: /Continue Book 2: Faithful in little/ })).toHaveAttribute('href', '/member/school/b2');
  });

  it('lets someone who has not started begin, explaining the price first', async () => {
    let started = false;
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school': () => ({ body: { ...SUMMARY, enrollment: started ? 'ACTIVE' : 'NONE', books: BOOKS.map((b) => ({ ...b, unlocked: false, lockedBecause: 'NOT_STARTED' })) } }),
      'POST /api/member/training/request': () => {
        started = true;
        return { status: 201, body: { enrollment: 'ACTIVE' } };
      },
    });
    renderAt('/member/school');
    expect(await screen.findByText(/Each book costs 1\s100 FCFA, paid before the next book opens/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Begin my training' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/member/training/request')).toBe(true));
    expect(await screen.findByText(/of 15 books passed/)).toBeInTheDocument();
  });
});

describe("A book's page", () => {
  const CHAPTERS = [
    { id: 'c1', order: 1, titleEn: 'A leader first serves', titleFr: null, summaryEn: 'Jesus washed the feet of His disciples.', summaryFr: null },
    { id: 'c2', order: 2, titleEn: 'Faithful in little things', titleFr: null, summaryEn: null, summaryFr: null },
  ];

  it('shows the cover, pages, chapter summaries, Read and the exam', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school/books/b1': () => ({ body: { ...SUMMARY, book: BOOKS[0], chapters: CHAPTERS } }),
    });
    renderAt('/member/school/b1');
    expect(await screen.findByRole('heading', { name: 'Called to serve' })).toBeInTheDocument();
    expect(screen.getByText('84 pages · 2 chapters')).toBeInTheDocument();
    expect(screen.getByText('✓ Passed with 90%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Read the book/ })).toHaveAttribute('href', '/member/read/b1');
    expect(screen.getByRole('link', { name: 'See results' })).toHaveAttribute('href', '/member/assessments/e1');
    expect(screen.getByRole('heading', { name: 'What this book teaches' })).toBeInTheDocument();
    expect(screen.getByText('Jesus washed the feet of His disciples.')).toBeInTheDocument();
    expect(screen.getByText('The summary of this chapter will be added soon.')).toBeInTheDocument();
    // Paid already: nothing to pay.
    expect(screen.queryByRole('button', { name: /Pay 1\s100 FCFA/ })).not.toBeInTheDocument();
  });

  it('a closed book still shows what it teaches, and why it is closed', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school/books/b3': () => ({ body: { ...SUMMARY, book: BOOKS[2], chapters: CHAPTERS } }),
    });
    renderAt('/member/school/b3');
    expect(await screen.findByText('Opens when you pass the Book 2 exam')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Read the book/ })).not.toBeInTheDocument();
    expect(screen.getByText('A leader first serves')).toBeInTheDocument();
  });

  it('an open book still to pay shows the exam with its one-try label and the pay button', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school/books/b2': () => ({ body: { ...SUMMARY, book: { ...BOOKS[1], lastPage: 34 }, chapters: [] } }),
    });
    renderAt('/member/school/b2');
    expect(await screen.findByText('How small faithfulness grows.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '📖 Continue reading · page 34' })).toHaveAttribute('href', '/member/read/b2');
    expect(screen.getByText(/Downloaded into the app the first time you open it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take the exam (one try)' })).toHaveAttribute('href', '/member/assessments/e2');
    expect(screen.getByRole('button', { name: /Pay 1\s100 FCFA/ })).toBeInTheDocument();
    expect(screen.getByText('The chapter summaries will be added soon.')).toBeInTheDocument();
  });

  it('says when the book is not in the school', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: ME }), 'GET /api/member/school/books/zz': () => ({ status: 404, body: { error: 'Book not found.' } }) });
    renderAt('/member/school/zz');
    expect(await screen.findByText('This book is not in the school.')).toBeInTheDocument();
  });
});
