import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../lib/bookCover', () => ({
  pictureToCover: vi.fn(async () => 'data:image/jpeg;base64,/9j/AAAA'),
  readPdfCover: vi.fn(async () => ({ pageCount: 84, cover: 'data:image/jpeg;base64,/9j/BBBB' })),
}));

import { BookDetailsAdmin } from '../components/admin/BookDetailsAdmin';
import { LibraryTab } from '../components/admin/LibraryTab';
import { BOOK1_PAGE } from './fixtures/book1Page';

// Central admin: a leadership book's cover, description and chapters
// (what members see on the book's page in the Leadership School).
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
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

const BOOK = { id: 'b1', trainingOrder: 1, titleEn: 'Called to serve', titleFr: null, descriptionEn: null, descriptionFr: null, coverUrl: null, coverSource: null, chapterCount: 0 };

describe('Leadership book details (admin)', () => {
  it('adds a chapter with its summary, edits, moves and deletes chapters', async () => {
    let chapters = [{ id: 'c1', order: 1, titleEn: 'A leader first serves', titleFr: null, summaryEn: null, summaryFr: null }];
    mockFetch({
      'GET /api/admin/library/books/b1/chapters': () => ({ body: { items: chapters } }),
      'POST /api/admin/library/books/b1/chapters': (body) => {
        chapters = [...chapters, { id: 'c2', order: 2, titleFr: null, summaryFr: null, ...body }];
        return { status: 201, body: chapters[1] };
      },
      'PATCH /api/admin/library/chapters/c1': (body) => {
        chapters = [{ ...chapters[0], ...body }, ...chapters.slice(1)];
        return { body: chapters[0] };
      },
      'POST /api/admin/library/chapters/c2/move': () => ({ body: { ok: true } }),
      'DELETE /api/admin/library/chapters/c2': () => {
        chapters = chapters.slice(0, 1);
        return { body: { ok: true } };
      },
    });
    const onChanged = vi.fn();
    render(<BookDetailsAdmin book={BOOK} onChanged={onChanged} />);
    expect(await screen.findByText('Chapter 1: A leader first serves')).toBeInTheDocument();
    expect(screen.getByText('No summary yet')).toBeInTheDocument();

    const addForm = screen.getByRole('button', { name: '＋ Add a chapter' }).closest('form')!;
    fireEvent.click(within(addForm).getByRole('button', { name: '＋ Add a chapter' }));
    expect(screen.getByText("Please write the chapter's title.")).toBeInTheDocument();
    fireEvent.change(within(addForm).getByLabelText('Chapter title (English)'), { target: { value: 'Faithful in little' } });
    fireEvent.change(within(addForm).getByLabelText('Summary (English)'), { target: { value: 'Small things first.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: '＋ Add a chapter' }));
    expect(await screen.findByText('Chapter 2: Faithful in little')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/chapters'))?.body).toEqual({ labelEn: '', labelFr: '', titleEn: 'Faithful in little', titleFr: '', summaryEn: 'Small things first.', summaryFr: '' });
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getAllByLabelText('Summary (English)')[0], { target: { value: 'Jesus washed their feet.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    await waitFor(() => expect(screen.getByText('Jesus washed their feet.')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/c2/move'))?.body).toEqual({ direction: 'UP' }));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    await waitFor(() => expect(screen.queryByText('Chapter 2: Faithful in little')).not.toBeInTheDocument());
  });

  it('pastes a whole book page, shows how it will look, and saves it only when told to', async () => {
    mockFetch({
      'GET /api/admin/library/books/b1/chapters': () => ({ body: { items: [] } }),
      'POST /api/admin/library/books/b1/page-import': () => ({ body: { ok: true, chapters: 8 } }),
    });
    const onChanged = vi.fn();
    render(<BookDetailsAdmin book={{ ...BOOK, titleEn: 'The Restoration of Dominion' }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste a whole book page/ }));
    const box = screen.getByLabelText('The book page');
    fireEvent.change(box, { target: { value: BOOK1_PAGE } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show how it will look' }));

    const preview = await screen.findByTestId('paste-preview');
    expect(screen.getByText('8 chapters found. This is how members will see it:')).toBeInTheDocument();
    // As he wrote it: big headline, labels above the titles, bullets, the closing words.
    expect(within(preview).getByText('Stop Being Pushed Around by Life. Start Ruling Over It.')).toBeInTheDocument();
    expect(within(preview).getByRole('heading', { name: 'Chapter by Chapter: Your Journey to Dominion' })).toBeInTheDocument();
    expect(within(preview).getByText('Chapter Three')).toBeInTheDocument();
    expect(within(preview).getByText('A Kingdom Bigger Than Any Problem You Face')).toBeInTheDocument();
    expect(within(preview).getByText('Appendix A')).toBeInTheDocument();
    expect(within(preview).getAllByRole('listitem').length).toBeGreaterThanOrEqual(8 + 5 + 5);
    expect(within(preview).getByText('This Book Is For You If...')).toBeInTheDocument();
    expect(within(preview).getByText('Your restoration begins on page one.').tagName).toBe('STRONG');
    // Nothing is saved until he says so.
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/page-import'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save this page to the book' }));
    expect(await screen.findByText('Saved. The book now has 8 chapters.')).toBeInTheDocument();
    const sent = calls.find((c) => c.url.endsWith('/page-import'))!.body;
    expect(sent.language).toBe('EN');
    expect(sent.chapters).toHaveLength(8);
    expect(sent.chapters[1]).toMatchObject({ label: 'Chapter One', title: 'You Were Born to Rule, Not to Struggle' });
    expect(sent.chaptersHeading).toBe('Chapter by Chapter: Your Journey to Dominion');
    expect(sent.description).toContain('# Stop Being Pushed Around');
    expect(sent.closing).toContain('## Why Read It Now?');
    expect(onChanged).toHaveBeenCalled();
  });

  it('asks before replacing chapters the book already has, and says when no chapters were found', async () => {
    mockFetch({
      'GET /api/admin/library/books/b1/chapters': () => ({ body: { items: [] } }),
      'POST /api/admin/library/books/b1/page-import': () => ({ body: { ok: true } }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<BookDetailsAdmin book={{ ...BOOK, chapterCount: 3 }} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste a whole book page/ }));
    fireEvent.change(screen.getByLabelText('The book page'), { target: { value: 'Just a paragraph with no chapters in it at all.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show how it will look' }));
    expect(screen.getByText(/No chapters were found/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('The book page'), { target: { value: BOOK1_PAGE } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show how it will look' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save this page to the book' }));
    expect(confirm).toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith('/page-import'))).toBe(false);
  });

  it('saves a chosen cover picture as the admin\'s own', async () => {
    mockFetch({
      'GET /api/admin/library/books/b1/chapters': () => ({ body: { items: [] } }),
      'PUT /api/admin/library/books/b1/cover': () => ({ body: { coverUrl: '/api/admin/library/books/b1/cover?v=1' } }),
    });
    const onChanged = vi.fn();
    render(<BookDetailsAdmin book={BOOK} onChanged={onChanged} />);
    expect(screen.getByText(/No cover yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a cover picture'), { target: { files: [new File(['x'], 'cover.png', { type: 'image/png' })] } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ image: 'data:image/jpeg;base64,/9j/AAAA', source: 'MANUAL', language: 'en' });
  });
});

// The browser sends the PDF to storage with XMLHttpRequest (it reports progress);
// this stands in for it, answering each PUT with the next status in `statuses`.
function fakeStorage(statuses: number[]) {
  const puts: string[] = [];
  class FakeXhr {
    status = 0;
    upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    private url = '';
    open(_m: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    send() {
      puts.push(this.url);
      const next = statuses.shift() ?? 200;
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
        if (next === 0) return this.onerror?.();
        this.status = next;
        this.onload?.();
      }, 0);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
  return puts;
}

const LIBRARY_ROUTES = {
  'GET /api/admin/library/books': () => ({ body: { items: [{ ...BOOK, kind: 'TRAINING', devotional: null, hasFile: false, byteSize: null, exam: null }] } }),
  'GET /api/admin/library/devotionals': () => ({ body: { items: [] } }),
  'GET /api/admin/library/trainees': () => ({ body: { items: [] } }),
  'GET /api/admin/library/retakes': () => ({ body: { items: [] } }),
  'GET /api/admin/library/payments': () => ({ body: { items: [] } }),
  'GET /api/admin/library/payments/summary': () => ({ body: { confirmed: { count: 0, amount: 0 }, thisMonth: { count: 0, amount: 0 }, waiting: 0 } }),
  'GET /api/admin/library/grace': () => ({ body: { items: [] } }),
  'GET /api/admin/library/training-settings': () => ({ body: { price: 1100, instructionsEn: '', instructionsFr: '', automaticProvider: null } }),
  'GET /api/admin/library/offering-settings': () => ({ body: { instructionsEn: '', instructionsFr: '' } }),
  'POST /api/admin/library/books/b1/file/authorize': () => ({ body: { storageKey: 'library/b1/k.pdf', uploadUrl: 'https://r2.example/put' } }),
  'POST /api/admin/library/books/b1/file': () => ({ body: { ok: true } }),
  'PUT /api/admin/library/books/b1/cover': () => ({ body: { coverUrl: 'x' } }),
  'POST /api/client-errors': () => ({ status: 202, body: { ok: true } }),
};

describe('Uploading a leadership book PDF (admin)', () => {
  it('keeps the page count and makes the cover from page 1', async () => {
    fakeStorage([200]);
    mockFetch({
      'GET /api/admin/library/books': () => ({ body: { items: [{ ...BOOK, kind: 'TRAINING', devotional: null, hasFile: false, byteSize: null, exam: null }] } }),
      'GET /api/admin/library/devotionals': () => ({ body: { items: [] } }),
      'GET /api/admin/library/trainees': () => ({ body: { items: [] } }),
      'GET /api/admin/library/retakes': () => ({ body: { items: [] } }),
      'GET /api/admin/library/payments': () => ({ body: { items: [] } }),
      'GET /api/admin/library/payments/summary': () => ({ body: { confirmed: { count: 0, amount: 0 }, thisMonth: { count: 0, amount: 0 }, waiting: 0 } }),
      'GET /api/admin/library/grace': () => ({ body: { items: [] } }),
      'GET /api/admin/library/training-settings': () => ({ body: { price: 1100, instructionsEn: '', instructionsFr: '', automaticProvider: null } }),
      'GET /api/admin/library/offering-settings': () => ({ body: { instructionsEn: '', instructionsFr: '' } }),
      'POST /api/admin/library/books/b1/file/authorize': () => ({ body: { storageKey: 'library/b1/k.pdf', uploadUrl: 'https://r2.example/put' } }),
      'PUT https://r2.example/put': () => ({ body: {} }),
      'POST /api/admin/library/books/b1/file': () => ({ body: { ok: true } }),
      'PUT /api/admin/library/books/b1/cover': () => ({ body: { coverUrl: 'x' } }),
    });
    render(<LibraryTab />);
    const input = await screen.findAllByLabelText('Upload English PDF');
    fireEvent.change(input[0], { target: { files: [new File(['%PDF'], 'book.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/cover'))).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/library/books/b1/file')?.body).toEqual({ storageKey: 'library/b1/k.pdf', byteSize: 4, pageCount: 84, language: 'en' });
    expect(calls.find((c) => c.url.endsWith('/cover'))?.body).toEqual({ image: 'data:image/jpeg;base64,/9j/BBBB', source: 'AUTO', language: 'en' });
  });

  it('has a separate upload for the French copy; it makes the French cover, not the English one', async () => {
    fakeStorage([200]);
    mockFetch({
      ...LIBRARY_ROUTES,
      'GET /api/admin/library/books': () => ({ body: { items: [{ ...BOOK, kind: 'TRAINING', devotional: null, hasFile: true, byteSize: 10, pageCount: 80, hasFileFr: false, exam: null }] } }),
    });
    render(<LibraryTab />);
    expect(await screen.findByText('✓ English PDF uploaded')).toBeInTheDocument();
    expect(screen.getByText('No French PDF yet')).toBeInTheDocument();
    const input = await screen.findAllByLabelText('Upload French PDF');
    fireEvent.change(input[0], { target: { files: [new File(['%PDF'], 'livre.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/library/books/b1/file')).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/library/books/b1/file')?.body).toEqual({ storageKey: 'library/b1/k.pdf', byteSize: 4, pageCount: 84, language: 'fr' });
    // The French PDF's page 1 becomes the French cover; the English cover is left alone.
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/cover'))).toBe(true));
    expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/cover')).map((c) => c.body.language)).toEqual(['fr']);
  });

  it('tries again once with a fresh link when the first send drops, then keeps the book', async () => {
    const puts = fakeStorage([0, 200]);
    mockFetch(LIBRARY_ROUTES);
    render(<LibraryTab />);
    const input = await screen.findAllByLabelText('Upload English PDF');
    fireEvent.change(input[0], { target: { files: [new File(['%PDF'], 'book.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/library/books/b1/file')).toBe(true));
    expect(puts).toHaveLength(2);
    expect(calls.filter((c) => c.url.endsWith('/file/authorize'))).toHaveLength(2);
  });

  it('says what storage answered when the send keeps failing, and tells the server log', async () => {
    const puts = fakeStorage([403, 403]);
    mockFetch(LIBRARY_ROUTES);
    render(<LibraryTab />);
    const input = await screen.findAllByLabelText('Upload English PDF');
    fireEvent.change(input[0], { target: { files: [new File(['%PDF'], 'book.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText('Upload failed. Please try again. (storage 403)')).toBeInTheDocument();
    expect(puts).toHaveLength(2);
    expect(calls.some((c) => c.url === '/api/admin/library/books/b1/file')).toBe(false);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/client-errors' && c.body?.kind === 'upload')).toBe(true));
  });
});

describe('Trainees: message, WhatsApp, and emailing the website link (admin)', () => {
  const trainee = (over: Record<string, unknown> = {}) => ({ personId: 'p1', name: 'Ada Obi', whatsappNumber: '+237670000001', status: 'ACTIVE', language: 'en', websiteInvitedAt: null, approvedByAdmin: true, requestedAt: null, activatedAt: '2026-11-10T10:00:00Z', note: null, graceBooks: 0, owedBooks: 0, ...over });

  it('writes to a trainee from the founder\'s own name, and opens WhatsApp with the website link in their language', async () => {
    mockFetch({
      ...LIBRARY_ROUTES,
      'GET /api/admin/library/trainees': () => ({ body: { items: [trainee(), trainee({ personId: 'p2', name: 'Beau Fils', whatsappNumber: '+237670000002', language: 'fr' })] } }),
      'GET /api/admin/library/website-invites': () => ({ body: { waiting: 0 } }),
      'POST /api/admin/library/trainees/p1/message': () => ({ body: { sent: true } }),
    });
    render(<LibraryTab />);
    fireEvent.click(await screen.findByTestId('trainee-message-p1'));
    fireEvent.change(screen.getByLabelText(/Write to Ada Obi/), { target: { value: 'Welcome, sister.' } });
    fireEvent.click(screen.getByTestId('trainee-message-send-p1'));
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/trainees/p1/message'))?.body).toEqual({ body: 'Welcome, sister.' });
    // WhatsApp: the right number, the website page, the person's own language.
    const en = decodeURIComponent((screen.getByTestId('trainee-whatsapp-p1') as HTMLAnchorElement).href);
    expect(en).toContain('https://wa.me/237670000001?text=Hello, greetings from The God Nation');
    expect(en).toContain(`${window.location.origin}/member/school`);
    expect(en).not.toContain('lang=fr');
    const fr = decodeURIComponent((screen.getByTestId('trainee-whatsapp-p2') as HTMLAnchorElement).href);
    expect(fr).toContain('Votre demande à l’École de leadership est approuvée');
    expect(fr).toContain('/member/school?lang=fr');
  });

  it('shows how many approved people have not been emailed, sends the next batch, and says what happened', async () => {
    let waiting = 130;
    mockFetch({
      ...LIBRARY_ROUTES,
      'GET /api/admin/library/website-invites': () => ({ body: { waiting } }),
      'POST /api/admin/library/website-invites/send': () => { waiting -= 100; return { body: { sent: 100, failed: 0, remaining: waiting, notConfigured: false } }; },
    });
    render(<LibraryTab />);
    expect(await screen.findByTestId('invites-waiting')).toHaveTextContent('130 approved people have not been emailed yet.');
    fireEvent.click(screen.getByTestId('invites-send'));
    expect(await screen.findByText('100 emailed, 0 failed, 30 still waiting.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/website-invites/send'))?.body).toEqual({ limit: 100 });
    expect(await screen.findByText('30 approved people have not been emailed yet.')).toBeInTheDocument();
  });

  it('says so when email is not set up, and when everyone has been emailed', async () => {
    mockFetch({
      ...LIBRARY_ROUTES,
      'GET /api/admin/library/website-invites': () => ({ body: { waiting: 3 } }),
      'POST /api/admin/library/website-invites/send': () => ({ body: { sent: 0, failed: 0, remaining: 3, notConfigured: true } }),
    });
    render(<LibraryTab />);
    fireEvent.click(await screen.findByTestId('invites-send'));
    expect(await screen.findByText('Email is not set up yet, so nothing was sent.')).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockFetch({ ...LIBRARY_ROUTES, 'GET /api/admin/library/website-invites': () => ({ body: { waiting: 0 } }) });
    render(<LibraryTab />);
    expect(await screen.findAllByText('Everyone you approved has been emailed.')).not.toHaveLength(0);
  });
});
