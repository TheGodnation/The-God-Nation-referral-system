import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberSchoolPage } from '../pages/MemberSchoolPage';
import { MemberSchoolBookPage } from '../pages/MemberSchoolBookPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// The God Nation Media & Leadership Academy: the books, level by level, as covers with their
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
  books: BOOKS.map((b) => ({ ...b, levelId: b.trainingOrder <= 2 ? 'l1' : 'l2' })),
  levels: [
    { id: 'l1', position: 1, titleEn: 'Level 1: Foundations', titleFr: 'Niveau 1 : Fondements', summaryEn: 'Where it starts.', summaryFr: null },
    { id: 'l2', position: 2, titleEn: 'Level 2: Kingdom Keys', titleFr: null, summaryEn: null, summaryFr: null },
  ],
  intro: { en: '# About this diploma\n\nA journey of {{books}} books in {{levels}} levels.\n@web Each book costs {{price}} FCFA.\n\n[[books]]\n\n# Graduation\n\nPass every exam.', fr: '# À propos\n\nUn parcours de {{books}} livres.\n\n[[books]]' },
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

describe('Leadership Academy page', () => {
  it('shows the books level by level as covers with their status, progress and where to continue', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: ME }), 'GET /api/member/school': () => ({ body: SUMMARY }) });
    renderAt('/member/school');
    expect(await screen.findByRole('heading', { name: 'The God Nation Media & Leadership Academy' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 books passed')).toBeInTheDocument();

    // Two level headings, each with its own books; no empty "coming soon" slots.
    expect(screen.getByRole('heading', { name: 'Level 1: Foundations' })).toBeInTheDocument();
    expect(screen.getByText('Where it starts.')).toBeInTheDocument();
    const levels = screen.getAllByTestId('academy-level');
    expect(levels).toHaveLength(2);
    expect(within(levels[0]).getAllByRole('listitem')).toHaveLength(2);
    expect(within(levels[1]).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Coming soon')).toBeNull();

    expect(screen.getByRole('img', { name: 'Cover of Book 1: Called to serve' })).toHaveAttribute('src', '/api/member/library/books/b1/cover?v=abc');
    // No cover picture yet: a drawn cover with the title.
    expect(screen.getByRole('img', { name: 'Cover of Book 2: Faithful in little' }).tagName).toBe('DIV');
    expect(screen.getByRole('link', { name: 'Book 1: Called to serve — ✓ Passed' })).toHaveAttribute('href', '/member/school/b1');
    expect(screen.getByRole('link', { name: 'Book 2: Faithful in little — Open' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book 3: Leading with vision — 🔒 Locked' })).toBeInTheDocument();

    // Book 1 is passed and paid, so Book 2 is where to carry on.
    expect(screen.getByRole('link', { name: /Continue Book 2: Faithful in little/ })).toHaveAttribute('href', '/member/school/b2');
    // Someone already studying finds the introduction folded away, with the numbers filled in.
    const folded = screen.getByTestId('academy-intro-folded');
    expect(folded.tagName).toBe('DETAILS');
    expect(within(folded).getByText(/A journey of 3 books in 2 levels\./)).toBeInTheDocument();
    expect(within(folded).getByText(/Each book costs 1\s100 FCFA\./)).toBeInTheDocument();
  });

  it('shows someone who has not begun the whole introduction, the books, then the way to begin', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school': () => ({ body: { ...SUMMARY, enrollment: 'NONE', books: SUMMARY.books.map((b) => ({ ...b, unlocked: false, lockedBecause: 'NOT_STARTED' })) } }),
    });
    renderAt('/member/school');
    const before = await screen.findByTestId('academy-intro-before');
    expect(within(before).getByText('About this diploma')).toBeInTheDocument();
    const after = screen.getByTestId('academy-intro-after');
    const levels = screen.getByTestId('academy-levels');
    const begin = screen.getByRole('button', { name: 'Begin my training' });
    // Order on the page: introduction, books, the rest of the introduction, then the Begin button.
    expect(before.compareDocumentPosition(levels) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(levels.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(after.compareDocumentPosition(begin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no prices in the Play Store version', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school': () => ({ body: { ...SUMMARY, enrollment: 'NONE', books: SUMMARY.books.map((b) => ({ ...b, unlocked: false, lockedBecause: 'NOT_STARTED' })) } }),
    });
    sessionStorage.setItem('godnation:store-app', '1');
    renderAt('/member/school');
    const before = await screen.findByTestId('academy-intro-before');
    expect(before.textContent).not.toMatch(/FCFA/);
    sessionStorage.removeItem('godnation:store-app');
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
    expect(await screen.findByText(/of 3 books passed/)).toBeInTheDocument();
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

  it("shows the founder's page as written: headline, bullets, labelled chapters, closing words, and the Read button above the pitch", async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/school/books/b1': () => ({
        body: {
          ...SUMMARY,
          book: {
            ...BOOKS[0],
            descriptionEn: '# Stop Being Pushed Around by Life.\n\nYou were made to govern.\n\n## What This Book Will Do For You\n\n- Show you the reason\n- Give you a picture',
            chaptersHeadingEn: 'Chapter by Chapter: Your Journey\nHere is what you will find inside.',
            closingEn: '## Why Read It Now?\n\nBecause *every day* you wait.',
            closingFr: null,
          },
          chapters: [{ id: 'c1', order: 1, labelEn: 'Chapter One', labelFr: null, titleEn: 'Born to Rule', titleFr: null, summaryEn: 'Before the stress there was a design.', summaryFr: null }],
        },
      }),
    });
    renderAt('/member/school/b1');
    expect(await screen.findByText('Stop Being Pushed Around by Life.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining(['Show you the reason', 'Give you a picture']));
    expect(screen.getByRole('heading', { name: 'Chapter by Chapter: Your Journey' })).toBeInTheDocument();
    expect(screen.getByText('Here is what you will find inside.')).toBeInTheDocument();
    expect(screen.getByText('Chapter One')).toBeInTheDocument();
    expect(screen.getByText('Born to Rule')).toBeInTheDocument();
    expect(screen.getByText('every day').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: /Read the book/ }).compareDocumentPosition(screen.getByText('You were made to govern.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What this book teaches' })).not.toBeInTheDocument();
  });

  describe('tapping the cover opens it big, like a profile photo', () => {
    const open = async (book: Record<string, unknown>) => {
      mockFetch({
        'GET /api/member/auth/me': () => ({ body: ME }),
        'GET /api/member/school/books/b1': () => ({ body: { ...SUMMARY, book, chapters: CHAPTERS } }),
      });
      renderAt('/member/school/b1');
      await screen.findByRole('heading', { name: 'Called to serve' });
    };

    it('shows the cover large with a way back, and a zoom', async () => {
      await open(BOOKS[0]);
      expect(screen.queryByTestId('cover-viewer')).toBeNull();
      expect(screen.getByText(/Tap the cover to see it bigger/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('open-cover'));
      const viewer = screen.getByTestId('cover-viewer');
      const big = within(viewer).getByRole('img', { name: 'Cover of Book 1: Called to serve' });
      expect(big).toHaveAttribute('src', '/api/member/library/books/b1/cover?v=abc');
      expect(big).toHaveAttribute('data-zoomed', 'false');
      // Come closer, and back out again.
      fireEvent.click(within(viewer).getByRole('button', { name: /Zoom in/ }));
      expect(big).toHaveAttribute('data-zoomed', 'true');
      fireEvent.click(big);
      expect(big).toHaveAttribute('data-zoomed', 'false');
    });

    it('goes back to the book with "Back to the book", the ✕, or the Escape key', async () => {
      await open(BOOKS[0]);
      for (const close of [
        () => fireEvent.click(screen.getByRole('button', { name: /Back to the book/ })),
        () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
        () => fireEvent.keyDown(window, { key: 'Escape' }),
      ]) {
        fireEvent.click(screen.getByTestId('open-cover'));
        expect(screen.getByTestId('cover-viewer')).toBeInTheDocument();
        close();
        expect(screen.queryByTestId('cover-viewer')).toBeNull();
        // The book page is still there, where it was.
        expect(screen.getByRole('heading', { name: 'Called to serve' })).toBeInTheDocument();
      }
    });

    it('offers to read the book from there, picking up at the last page', async () => {
      await open({ ...BOOKS[0], lastPage: 71 });
      fireEvent.click(screen.getByTestId('open-cover'));
      expect(within(screen.getByTestId('cover-viewer')).getByRole('link', { name: /Continue reading · page 71/ })).toHaveAttribute('href', '/member/read/b1');
    });

    it('does not offer reading for a book that cannot be read yet', async () => {
      await open({ ...BOOKS[0], canRead: false, unlocked: false });
      fireEvent.click(screen.getByTestId('open-cover'));
      expect(within(screen.getByTestId('cover-viewer')).queryByRole('link')).toBeNull();
    });

    it('a book with no cover picture has nothing to enlarge', async () => {
      mockFetch({
        'GET /api/member/auth/me': () => ({ body: ME }),
        'GET /api/member/school/books/b2': () => ({ body: { ...SUMMARY, book: BOOKS[1], chapters: [] } }),
      });
      renderAt('/member/school/b2');
      await screen.findByRole('heading', { name: 'Faithful in little' });
      expect(screen.queryByTestId('open-cover')).toBeNull();
    });

    it('is in French too, with the French cover', async () => {
      const { default: i18n } = await import('../i18n');
      await i18n.changeLanguage('fr');
      await open({ ...BOOKS[0], coverUrlFr: '/api/member/library/books/b1/cover?lang=fr' }).catch(() => {});
      await screen.findByText(/Touchez la couverture pour la voir en grand/);
      fireEvent.click(screen.getByTestId('open-cover'));
      const viewer = screen.getByTestId('cover-viewer');
      expect(within(viewer).getByRole('button', { name: /Retour au livre/ })).toBeInTheDocument();
      expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/api/member/library/books/b1/cover?lang=fr');
      await i18n.changeLanguage('en');
    });
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
    expect(screen.getByText(/Downloaded in your phone the first time you open it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take the exam (one try)' })).toHaveAttribute('href', '/member/assessments/e2');
    expect(screen.getByRole('button', { name: /Pay 1\s100 FCFA/ })).toBeInTheDocument();
    // No placeholder lines for a book that has no page written: the Academy page carries the introduction.
    expect(screen.queryByText('The chapter summaries will be added soon.')).toBeNull();
  });

  it('says when the book is not in the Academy', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: ME }), 'GET /api/member/school/books/zz': () => ({ status: 404, body: { error: 'Book not found.' } }) });
    renderAt('/member/school/zz');
    expect(await screen.findByText('This book is not in the Academy.')).toBeInTheDocument();
  });
});
