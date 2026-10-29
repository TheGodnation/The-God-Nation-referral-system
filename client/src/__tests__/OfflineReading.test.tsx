import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const fakeDoc = {
  numPages: 3,
  getPage: vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  })),
  getData: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  destroy: vi.fn(),
};
vi.mock('../lib/loadPdfJs', () => ({
  PDFJS_WORKER_URL: 'https://cdn.example/pdf.worker.min.js',
  loadPdfJs: vi.fn(async () => ({ getDocument: () => ({ promise: Promise.resolve(fakeDoc), destroy: () => {} }) })),
}));

import { MemberReaderPage } from '../pages/MemberReaderPage';
import { MemberDownloadsPage } from '../pages/MemberDownloadsPage';
import { PdfViewer } from '../components/chat/PdfViewer';
import { MemberAuthProvider, useMemberAuth } from '../lib/MemberAuthContext';
import { bookKey, docKey, getInfo, listSaved, saveFile } from '../lib/offlineStore';

// Books downloaded into the app (they open again without internet), the
// reading bookmark, chat PDFs kept after viewing, and the Downloads page.
const calls: { url: string; method: string; body: any }[] = [];
let online = true;
let n = 0;
let personId = '';

const me = () => ({ member: { name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId, profileComplete: true } });
const info = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  kind: 'TRAINING',
  titleEn: 'Called to serve',
  titleFr: null,
  trainingOrder: 1,
  examId: 'e1',
  watermark: 'Mary · +237',
  fileVersion: 'v1',
  byteSize: 4,
  pageCount: 3,
  progress: null,
  ...over,
});

function mockFetch(routes: Record<string, (body: any) => { status?: number; body?: unknown; bytes?: boolean }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (!online) throw new TypeError('Failed to fetch');
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return {
        ok: status < 300,
        status,
        headers: { get: (h: string) => (res.bytes ? (h === 'content-length' ? '4' : 'application/pdf') : 'application/json') },
        json: async () => res.body,
        arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
        body: null,
      };
    }),
  );
}

beforeEach(() => {
  n += 1;
  personId = `p${n}`;
  online = true;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 360 });
  window.scrollTo = vi.fn() as any;
  HTMLCanvasElement.prototype.getContext = (() => null) as any;
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  localStorage.clear();
});

function renderReader() {
  return render(
    <MemoryRouter initialEntries={['/member/read/b1']}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/read/:bookId" element={<MemberReaderPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Leadership books downloaded into the app', () => {
  it('downloads the book the first time, then opens the kept copy without internet', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/member/library/books/b1/content': () => ({ bytes: true }),
      'GET /api/member/library/books/b1': () => ({ body: info() }),
    });
    const first = renderReader();
    expect(await screen.findByText(/Downloaded\. This book now opens on this phone even without internet\./)).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Page \d$/)).toHaveLength(3);
    expect(await getInfo(bookKey(personId, 'b1'))).toMatchObject({ kind: 'BOOK', version: 'v1', byteSize: 4 });
    first.unmount();

    // Opened again with internet: same version, so no second download.
    calls.length = 0;
    const second = renderReader();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/content'))).toBe(false);
    second.unmount();

    // No internet at all: the kept copy opens, without the exam button.
    localStorage.setItem('member:last', JSON.stringify(me().member));
    online = false;
    renderReader();
    expect(await screen.findByText(/No internet — reading the copy downloaded on this phone\./)).toBeInTheDocument();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Take the exam (one try)' })).not.toBeInTheDocument();
  });

  it('lets the reader make the pages bigger or smaller, keeps the same page in view, and remembers the choice', async () => {
    localStorage.removeItem('reader-zoom');
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/member/library/books/b1/content': () => ({ bytes: true }),
      'GET /api/member/library/books/b1': () => ({ body: info() }),
    });
    renderReader();
    await screen.findByText('Page 1 of 3');
    const pageWidth = () => (screen.getAllByLabelText(/^Page \d$/)[0].parentElement as HTMLElement).style.width;
    expect(pageWidth()).toBe('352px'); // the screen's width, fitted
    expect(screen.getByTestId('reader-zoom')).toHaveTextContent('100%');
    expect(screen.getByRole('button', { name: 'Smaller text' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
    expect(screen.getByTestId('reader-zoom')).toHaveTextContent('125%');
    expect(pageWidth()).toBe('440px');
    fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
    expect(pageWidth()).toBe('528px');
    expect(localStorage.getItem('reader-zoom')).toBe('1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }));
    expect(pageWidth()).toBe('440px');
  });

  it('opens at the size the reader chose before', async () => {
    localStorage.setItem('reader-zoom', '2');
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/member/library/books/b1/content': () => ({ bytes: true }),
      'GET /api/member/library/books/b1': () => ({ body: info() }),
    });
    renderReader();
    await screen.findByText('Page 1 of 3');
    expect(screen.getByTestId('reader-zoom')).toHaveTextContent('200%');
    expect((screen.getAllByLabelText(/^Page \d$/)[0].parentElement as HTMLElement).style.width).toBe('704px');
    localStorage.removeItem('reader-zoom');
  });

  it('downloads it again when the admin replaced the PDF, and removes the copy when the book is closed again', async () => {
    await saveFile({ key: bookKey(personId, 'b1'), ownerId: personId, kind: 'BOOK', title: 'Called to serve', version: 'old', meta: info(), blob: new Blob([new Uint8Array([1])]) });
    let status = 200;
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/member/library/books/b1/content': () => ({ bytes: true }),
      'GET /api/member/library/books/b1': () => (status === 200 ? { body: info() } : { status, body: { error: 'Book not found.' } }),
    });
    const r = renderReader();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/content'))).toBe(true);
    expect((await getInfo(bookKey(personId, 'b1')))?.version).toBe('v1');
    r.unmount();

    status = 404;
    renderReader();
    expect(await screen.findByText('This book is not open for you yet.')).toBeInTheDocument();
    await waitFor(async () => expect(await getInfo(bookKey(personId, 'b1'))).toBeNull());
  });

  it('says so when there is no internet and the book was never downloaded', async () => {
    localStorage.setItem('member:last', JSON.stringify(me().member));
    online = false;
    mockFetch({});
    renderReader();
    expect(await screen.findByText(/No internet, and this book is not downloaded on this phone yet/)).toBeInTheDocument();
  });
});

describe('Reading bookmark', () => {
  it('opens where the reader stopped on this phone, and sends it to the server', async () => {
    localStorage.setItem(`reading:${personId}:b1`, JSON.stringify({ page: 3, at: new Date().toISOString(), synced: false }));
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/member/library/books/b1/content': () => ({ bytes: true }),
      'GET /api/member/library/books/b1': () => ({ body: info({ progress: { page: 2, at: new Date(Date.now() - 86400000).toISOString() } }) }),
      'PUT /api/member/library/books/b1/progress': (b) => ({ body: { page: b.page } }),
    });
    renderReader();
    expect(await screen.findByText('Opened where you stopped: page 3')).toBeInTheDocument();
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalled());
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ page: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to the start' }));
    expect(screen.queryByText('Opened where you stopped: page 3')).not.toBeInTheDocument();
  });

  it('uses the server bookmark when it is newer (read on another phone)', async () => {
    localStorage.setItem(`reading:${personId}:b1`, JSON.stringify({ page: 2, at: new Date(Date.now() - 86400000).toISOString(), synced: true }));
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/member/library/books/b1/content': () => ({ bytes: true }),
      'GET /api/member/library/books/b1': () => ({ body: info({ progress: { page: 3, at: new Date().toISOString() } }) }),
    });
    renderReader();
    expect(await screen.findByText('Opened where you stopped: page 3')).toBeInTheDocument();
  });
});

describe('Chat PDFs and the Downloads page', () => {
  it('keeps a chat PDF on the phone after it is viewed', async () => {
    render(<PdfViewer url="https://storage.example/doc.pdf" name="Report.pdf" keep={{ key: docKey(personId, 'att1'), ownerId: personId, meta: { messageId: 'm1' } }} onClose={() => {}} />);
    await waitFor(async () => expect(await getInfo(docKey(personId, 'att1'))).toMatchObject({ kind: 'DOC', title: 'Report.pdf', byteSize: 4 }));
  });

  it('lists books and documents kept on this phone, and deletes them', async () => {
    await saveFile({ key: bookKey(personId, 'b1'), ownerId: personId, kind: 'BOOK', title: 'Called to serve', version: 'v1', meta: info(), blob: new Blob([new Uint8Array(2 * 1024 * 1024)]) });
    await saveFile({ key: docKey(personId, 'att1'), ownerId: personId, kind: 'DOC', title: 'Report.pdf', meta: {}, blob: new Blob([new Uint8Array(1024)]) });
    // Someone else's download on the same phone is not shown.
    await saveFile({ key: docKey('other', 'att9'), ownerId: 'other', kind: 'DOC', title: 'Not mine.pdf', meta: {}, blob: new Blob([new Uint8Array(10)]) });
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: me() }) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter>
        <MemberAuthProvider>
          <MemberDownloadsPage />
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Book 1: Called to serve')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/member/read/b1');
    expect(screen.getByText('Report.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Not mine.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('Using 2.0 MB on this phone')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    await waitFor(() => expect(screen.queryByText('Report.pdf')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete all downloads from this phone' }));
    expect(await screen.findByText(/No book downloaded yet/)).toBeInTheDocument();
    expect(await listSaved('other')).toHaveLength(1);
  });
});

describe('Opening the app without internet', () => {
  function WhoAmI() {
    const { member, loading, logout } = useMemberAuth();
    return (
      <>
        <p>{loading ? 'loading' : member ? `signed in: ${member.name}` : 'signed out'}</p>
        <button type="button" onClick={() => logout()}>
          Sign out
        </button>
      </>
    );
  }

  it('uses the member signed in last on this phone; signing out forgets them and their downloads', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: me() }), 'POST /api/member/auth/logout': () => ({ body: { ok: true } }) });
    const first = render(
      <MemberAuthProvider>
        <WhoAmI />
      </MemberAuthProvider>,
    );
    expect(await screen.findByText('signed in: Mary')).toBeInTheDocument();
    first.unmount();

    online = false;
    const offline = render(
      <MemberAuthProvider>
        <WhoAmI />
      </MemberAuthProvider>,
    );
    expect(await screen.findByText('signed in: Mary', {}, { timeout: 3000 })).toBeInTheDocument();
    offline.unmount();
    expect(JSON.parse(localStorage.getItem('member:last') ?? '{}').personId).toBe(personId);

    online = true;
    await saveFile({ key: bookKey(personId, 'b1'), ownerId: personId, kind: 'BOOK', title: 'Called to serve', meta: info(), blob: new Blob([new Uint8Array(4)]) });
    render(
      <MemberAuthProvider>
        <WhoAmI />
      </MemberAuthProvider>,
    );
    expect(await screen.findByText('signed in: Mary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('signed out')).toBeInTheDocument();
    expect(localStorage.getItem('member:last')).toBeNull();
    await waitFor(async () => expect(await listSaved(personId)).toHaveLength(0));
  });
});
