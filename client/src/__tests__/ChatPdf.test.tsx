import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// The first page and page count are read on the sender's phone with PDF.js
// (loaded from the internet); here they are faked.
const PAGE_TOP = 'data:image/jpeg;base64,AAAA';
vi.mock('../lib/pdfPreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pdfPreview')>()),
  readPdf: vi.fn(async () => ({ pageCount: 71, thumb: PAGE_TOP, pageImage: PAGE_TOP })),
}));
const fakeDoc = {
  numPages: 2,
  getPage: vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 141 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  })),
  destroy: vi.fn(),
};
vi.mock('../lib/loadPdfJs', () => ({
  loadPdfJs: vi.fn(async () => ({ getDocument: () => ({ promise: Promise.resolve(fakeDoc), destroy: () => {} }) })),
}));

import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import { MessageBubble } from '../components/chat/MessageBubble';

// PDFs the WhatsApp way: the top of page 1 and "71 pages • 3.3 MB • PDF" on
// the bubble, the first page on the preview screen, and opened in the app.
const G = 'g1';
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      let res: unknown = null;
      if (url.includes('/download-url')) res = { url: 'https://storage.example/get/doc.pdf' };
      else if (url.includes('/conversation/messages') && method === 'GET') res = { items: [], hasMore: false, unreadCount: 0, canPost: true };
      else if (url.includes('/attachments/authorize')) res = { storageKey: 'k1', uploadUrl: 'https://storage.example/put' };
      else if (url.includes('/conversation/messages') && method === 'POST') res = { id: 'new1' };
      const status = res === null ? 404 : 200;
      return Promise.resolve({ ok: status === 200, status, headers: { get: () => 'application/json' }, json: async () => res ?? { error: 'not found' } });
    }),
  );
}

class FakeXhr {
  static all: FakeXhr[] = [];
  upload = { onprogress: null as null | ((e: any) => void) };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  open() {}
  setRequestHeader() {}
  send() {
    FakeXhr.all.push(this);
  }
  abort() {
    this.onabort?.();
  }
  finish() {
    this.status = 200;
    this.onload?.();
  }
}

beforeEach(() => {
  FakeXhr.all = [];
  mockFetch();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('Sending a PDF', () => {
  it('shows its first page before sending, then posts its page count and page preview', async () => {
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Emojis' });
    const pdf = new File([new Uint8Array(3_500_000)], 'Informations.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('chat-document-input'), { target: { files: [pdf] } });

    const preview = screen.getByRole('dialog', { name: 'Send photos' });
    expect(await within(preview).findByAltText('Informations.pdf')).toHaveAttribute('src', PAGE_TOP);
    expect(within(preview).getByText('71 pages • 3.3 MB • PDF')).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('71 pages • 3.3 MB • PDF')).toBeInTheDocument();
    await waitFor(() => expect(FakeXhr.all).toHaveLength(1));
    await act(async () => FakeXhr.all[0].finish());
    await waitFor(() => {
      const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'));
      expect(sent?.body.attachments[0]).toMatchObject({ originalFilename: 'Informations.pdf', mimeType: 'application/pdf', pageCount: 71, thumb: PAGE_TOP });
    });
  });
});

describe('A PDF in the chat', () => {
  const message = {
    id: 'm1',
    senderName: 'Ada',
    isOwn: false,
    body: null,
    createdAt: new Date().toISOString(),
    deleted: false,
    attachments: [{ id: 'a1', originalFilename: 'Informations.pdf', mimeType: 'application/pdf', byteSize: 3_500_000, pageCount: 71, thumb: PAGE_TOP }],
  };

  it('shows the top of page 1 and "71 pages • 3.3 MB • PDF", and opens inside the app', async () => {
    render(
      <MemoryRouter>
        <MessageBubble
          m={message}
          mediaBase="/api/communities/g1/conversation"
          showSender={false}
          highlighted={false}
          onReply={vi.fn()}
          onMenu={vi.fn()}
          onReact={vi.fn()}
          onJumpTo={vi.fn()}
          onOpenPhoto={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('71 pages • 3.3 MB • PDF')).toBeInTheDocument();
    expect(document.querySelector(`img[src="${PAGE_TOP}"]`)).not.toBeNull();

    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByRole('button', { name: /Informations\.pdf/ }));
    const viewer = await screen.findByRole('dialog', { name: 'Informations.pdf' });
    expect(await within(viewer).findByText('2 pages')).toBeInTheDocument();
    expect(within(viewer).getByRole('link', { name: 'Download' })).toHaveAttribute('href', 'https://storage.example/get/doc.pdf');
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(within(viewer).getByRole('button', { name: 'Back to the chat' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
