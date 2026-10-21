import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../lib/bookCover', () => ({
  pictureToCover: vi.fn(async () => 'data:image/jpeg;base64,/9j/AAAA'),
  readPdfCover: vi.fn(async () => ({ pageCount: 84, cover: 'data:image/jpeg;base64,/9j/BBBB' })),
}));

import { BookDetailsAdmin } from '../components/admin/BookDetailsAdmin';
import { LibraryTab } from '../components/admin/LibraryTab';

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
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/chapters'))?.body).toEqual({ titleEn: 'Faithful in little', titleFr: '', summaryEn: 'Small things first.', summaryFr: '' });
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
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ image: 'data:image/jpeg;base64,/9j/AAAA', source: 'MANUAL' });
  });
});

describe('Uploading a leadership book PDF (admin)', () => {
  it('keeps the page count and makes the cover from page 1', async () => {
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
    const input = await screen.findAllByLabelText('Upload PDF');
    fireEvent.change(input[0], { target: { files: [new File(['%PDF'], 'book.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/cover'))).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/library/books/b1/file')?.body).toEqual({ storageKey: 'library/b1/k.pdf', byteSize: 4, pageCount: 84 });
    expect(calls.find((c) => c.url.endsWith('/cover'))?.body).toEqual({ image: 'data:image/jpeg;base64,/9j/BBBB', source: 'AUTO' });
  });
});
