import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';

// Sending a photo the WhatsApp way: it shows in the chat at once with a
// progress circle, is posted once uploaded, and can be stopped or retried.
const G = 'g1';
const calls: { url: string; method: string; body: any }[] = [];
let posted: any[] = [];

function mockFetch(extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  const routes: Record<string, (body: any) => { status?: number; body: unknown }> = {
    'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
    [`GET /api/communities/${G}/conversation/messages`]: () => ({
      body: { items: posted, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true },
    }),
    [`POST /api/communities/${G}/attachments/authorize`]: () => ({ body: { storageKey: 'k1', uploadUrl: 'https://storage.example/put' } }),
    [`POST /api/communities/${G}/conversation/messages`]: (body) => {
      posted = [
        {
          id: 'new1',
          senderName: 'Me',
          isOwn: true,
          body: null,
          createdAt: new Date().toISOString(),
          deleted: false,
          attachments: body.attachments.map((a: any, i: number) => ({ id: `a${i}`, originalFilename: a.originalFilename, mimeType: a.mimeType, byteSize: a.byteSize })),
          replyTo: null,
          reactions: [],
        },
      ];
      return { body: { id: 'new1' } };
    },
    ...extra,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 200, body: {} };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

// The upload itself goes through XMLHttpRequest (it reports progress).
class FakeXhr {
  static all: FakeXhr[] = [];
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  url = '';
  open(_m: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send() {
    FakeXhr.all.push(this);
  }
  abort() {
    this.onabort?.();
  }
  progress(fraction: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: fraction * 100, total: 100 });
  }
  finish(status = 200) {
    this.status = status;
    if (status) this.onload?.();
    else this.onerror?.();
  }
}

beforeEach(() => {
  FakeXhr.all = [];
  posted = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

function renderChat() {
  return render(
    <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
      <Routes>
        <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function pick(...names: string[]) {
  const files = names.map((n) => new File(['x'], n, { type: 'image/png' }));
  fireEvent.change(screen.getByTestId('chat-gallery-input'), { target: { files } });
}

async function openChat() {
  mockFetch();
  renderChat();
  await screen.findByRole('button', { name: 'Emojis' });
}

async function pickPhoto(caption?: string) {
  await openChat();
  pick('church.png');
  const preview = screen.getByRole('dialog', { name: 'Send photos' });
  if (caption) fireEvent.change(within(preview).getByLabelText('Add a caption…'), { target: { value: caption } });
  fireEvent.click(within(preview).getByRole('button', { name: 'Send' }));
  await screen.findByTestId('uploading-bubble');
  await waitFor(() => expect(FakeXhr.all).toHaveLength(1));
}

const postedMessage = () => calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'));

describe('Sending a photo in the chat', () => {
  it('shows it in the chat at once with its progress, then posts it once uploaded', async () => {
    await pickPhoto();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    act(() => FakeXhr.all[0].progress(0.4));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText(/40%/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'))).toBe(false);

    await act(async () => FakeXhr.all[0].finish(200));
    await waitFor(() => expect(screen.queryByTestId('uploading-bubble')).not.toBeInTheDocument());
    const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'));
    expect(sent?.body.attachments[0]).toMatchObject({ storageKey: 'k1', originalFilename: 'church.png', mimeType: 'image/png' });
  });

  it('the ✕ stops it: nothing is posted', async () => {
    await pickPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sending' }));
    expect(screen.queryByTestId('uploading-bubble')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'))).toBe(false);
  });

  it('a failed upload says so and can be tried again', async () => {
    await pickPhoto();
    await act(async () => FakeXhr.all[0].finish(0));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file could not be sent');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    await act(async () => FakeXhr.all[1].finish(200));
    await waitFor(() => expect(screen.queryByTestId('uploading-bubble')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'))).toHaveLength(1);
  });

  it('sends the caption with the photo, and shows it under the photo while it goes up', async () => {
    await pickPhoto('Sunday service 🙏');
    expect(screen.getByTestId('uploading-bubble')).toHaveTextContent('Sunday service 🙏');
    await act(async () => FakeXhr.all[0].finish(200));
    await waitFor(() => expect(postedMessage()?.body.body).toBe('Sunday service 🙏'));
  });
});

describe('The preview screen before sending', () => {
  it('nothing is uploaded until Send, and closing it sends nothing', async () => {
    await openChat();
    pick('church.png');
    expect(screen.getByRole('dialog', { name: 'Send photos' })).toBeInTheDocument();
    expect(FakeXhr.all).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('uploading-bubble')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/attachments/authorize'))).toBe(false);
  });

  it('can add more photos, drop one, and sends the rest together in one message', async () => {
    await openChat();
    pick('a.png', 'b.png');
    const preview = screen.getByRole('dialog', { name: 'Send photos' });
    expect(within(preview).getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole('button', { name: 'Add more' }));
    pick('c.png');
    expect(within(preview).getByText('1 / 3')).toBeInTheDocument();

    fireEvent.click(within(preview).getByRole('button', { name: 'Show b.png' }));
    fireEvent.click(within(preview).getByRole('button', { name: 'Remove b.png' }));
    expect(within(preview).queryByRole('button', { name: 'Show b.png' })).not.toBeInTheDocument();

    fireEvent.click(within(preview).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    await act(async () => FakeXhr.all.forEach((x) => x.finish(200)));
    await waitFor(() => expect(postedMessage()?.body.attachments.map((a: any) => a.originalFilename)).toEqual(['a.png', 'c.png']));
  });

  it('what was already typed in the bar becomes the caption', async () => {
    await openChat();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Look at this' } });
    pick('church.png');
    const preview = screen.getByRole('dialog', { name: 'Send photos' });
    expect(within(preview).getByLabelText('Add a caption…')).toHaveValue('Look at this');
    fireEvent.click(within(preview).getByRole('button', { name: 'Send' }));
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });
});
