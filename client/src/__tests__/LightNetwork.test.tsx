import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { appendNew, applyRecent, lastServerId } from '../lib/chatSync';
import { MemberPrivateChatPage } from '../pages/MemberPrivateChatPage';
import { ConnectionBar } from '../components/member/ConnectionBar';
import { DataSaverSetting } from '../components/member/DataSaverSetting';
import type { ChatMessage } from '../components/chat/types';

const calls: { url: string; method: string; body: any }[] = [];
let offline = false;
// When set, a POST never answers (a very weak network) until the request is stopped.
let hangPosts = false;

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (offline && method === 'POST') return Promise.reject(new TypeError('Failed to fetch'));
      if (hangPosts && method === 'POST') {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: {} };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  offline = false;
  hangPosts = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  localStorage.clear();
  delete (navigator as unknown as { connection?: unknown }).connection;
});

const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  senderName: 'A',
  isOwn: true,
  body: id,
  createdAt: '2026-10-06T10:00:00Z',
  deleted: false,
  attachments: [],
  ...extra,
});

describe('Light syncing helpers', () => {
  it('adds only new messages and keeps sending ones at the end', () => {
    const prev = [msg('a'), msg('b'), msg('tmp', { pending: true })];
    const next = appendNew(prev, [msg('b'), msg('c')]);
    expect(next.map((m) => m.id)).toEqual(['a', 'b', 'c', 'tmp']);
    expect(lastServerId(next)).toBe('c');
  });

  it('applies ticks, reactions and removals to recent messages', () => {
    const prev = [msg('a', { status: 'sent' }), msg('b')];
    const next = applyRecent(prev, [
      { id: 'a', status: 'read', reactions: [{ emoji: '🙏', count: 1, mine: false }] },
      { id: 'b', deleted: true },
    ]);
    expect(next[0].status).toBe('read');
    expect(next[0].reactions).toEqual([{ emoji: '🙏', count: 1, mine: false }]);
    expect(next[1]).toMatchObject({ deleted: true, body: null });
    // Nothing changed: same list back (no re-render).
    expect(applyRecent(next, [{ id: 'a', status: 'read', reactions: [{ emoji: '🙏', count: 1, mine: false }] }])).toBe(next);
  });
});

const BASE = '/api/private-messages/conversations/c1';
const now = new Date().toISOString();
function chatBody(items: unknown[]) {
  return { items, hasMore: false, unreadCount: 0, otherPartyType: 'MEMBER', otherPartyName: 'Grace', otherPartyPersonId: 'p2', otherPartyPhotoUrl: null, otherPartyPresence: null, typing: false };
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/member/chats/private/c1']}>
      <Routes>
        <Route path="/member/chats/private/:conversationId" element={<MemberPrivateChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Photos on slow networks', () => {
  const photoMsg = {
    id: 'm1',
    isOwn: false,
    body: '',
    createdAt: now,
    attachments: [{ id: 'a1', originalFilename: 'p.jpg', mimeType: 'image/jpeg', byteSize: 250000, thumb: 'data:image/jpeg;base64,AAAA' }],
    reactions: [],
    replyTo: null,
  };

  it('shows the tiny preview straight away', async () => {
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({ body: chatBody([photoMsg]) }),
      [`GET ${BASE}/messages/m1/attachments/a1/download-url`]: () => ({ body: { url: 'https://files.example/p.jpg' } }),
    });
    const { container } = renderChat();
    await waitFor(() => expect(container.querySelector('img[src^="data:image/jpeg"]')).not.toBeNull());
  });

  it('with "Save data" on, the photo downloads only after a tap', async () => {
    // "Automatic" turns save-data on by itself on a very slow network —
    // there is no manual "always save data" option any more.
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    // A different message/attachment id than the test above — getAttachmentUrl
    // caches download links for a few minutes, so reusing "a1" here would
    // silently serve that test's cached URL instead of exercising this tap.
    const saverPhotoMsg = {
      ...photoMsg,
      id: 'm2',
      attachments: [{ ...photoMsg.attachments[0], id: 'a2' }],
    };
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({ body: chatBody([saverPhotoMsg]) }),
      [`GET ${BASE}/messages/m2/attachments/a2/download-url`]: () => ({ body: { url: 'https://files.example/p.jpg' } }),
    });
    renderChat();
    const button = await screen.findByRole('button', { name: /Download photo/ });
    expect(calls.some((c) => c.url.includes('download-url'))).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url.includes('download-url'))).toBe(true));
  });
});

describe('Weak network', () => {
  it('keeps a message typed offline with 🕓 and sends it when the network is back', async () => {
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({ body: chatBody([]) }),
      [`POST ${BASE}/messages`]: () => ({ status: 201, body: { id: 'm9' } }),
    });
    renderChat();
    await screen.findByText(/Say hello to Grace/);
    offline = true;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Are you there?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Waiting for network/)).toBeInTheDocument();
    expect(screen.getByText('Are you there?')).toBeInTheDocument();
    expect(localStorage.getItem('outbox:private:c1')).toContain('Are you there?');

    offline = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url === `${BASE}/messages`).length).toBe(2));
    await waitFor(() => expect(localStorage.getItem('outbox:private:c1')).toBeNull());
  });

  it('lets the person delete a message that is waiting for the network: it is never sent', async () => {
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({ body: chatBody([]) }),
      [`POST ${BASE}/messages`]: () => ({ status: 201, body: { id: 'm9' } }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderChat();
    await screen.findByText(/Say hello to Grace/);
    offline = true;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Sent by mistake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Waiting for network/)).toBeInTheDocument();
    expect(localStorage.getItem('outbox:private:c1')).toContain('Sent by mistake');

    fireEvent.click(screen.getByTestId('cancel-pending'));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByText('Sent by mistake')).not.toBeInTheDocument();
    expect(screen.getByText('Deleted. It was never sent.')).toBeInTheDocument();
    expect(localStorage.getItem('outbox:private:c1')).toBeNull();

    // The network comes back: nothing is sent.
    const postsBefore = calls.filter((c) => c.method === 'POST' && c.url === `${BASE}/messages`).length;
    offline = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.filter((c) => c.method === 'POST' && c.url === `${BASE}/messages`).length).toBe(postsBefore);
    confirm.mockRestore();
  });

  it('keeps the message if the person says no to deleting it', async () => {
    mockFetch({ [`GET ${BASE}/messages`]: () => ({ body: chatBody([]) }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderChat();
    await screen.findByText(/Say hello to Grace/);
    offline = true;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Waiting for network/);
    fireEvent.click(screen.getByTestId('cancel-pending'));
    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(localStorage.getItem('outbox:private:c1')).toContain('Keep me');
    vi.restoreAllMocks();
  });

  it('lets the person delete a message that is still being sent on a very weak network: the request is stopped', async () => {
    mockFetch({ [`GET ${BASE}/messages`]: () => ({ body: chatBody([]) }) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderChat();
    await screen.findByText(/Say hello to Grace/);
    hangPosts = true;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Stuck on the way' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Sending…/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cancel-pending'));
    await waitFor(() => expect(screen.queryByText('Stuck on the way')).not.toBeInTheDocument());
    expect(screen.getByText(/Stopped\./)).toBeInTheDocument();
    // Stopping it is not a network problem: nothing is saved to send later.
    await new Promise((r) => setTimeout(r, 60));
    expect(localStorage.getItem('outbox:private:c1')).toBeNull();
    vi.restoreAllMocks();
  });

  it('shows "Connecting…" when the server cannot be reached', async () => {
    render(<ConnectionBar />);
    act(() => {
      window.dispatchEvent(new CustomEvent('api-reachable', { detail: false }));
    });
    expect(await screen.findByText(/Connecting…/)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('api-reachable', { detail: true }));
    });
    await waitFor(() => expect(screen.queryByText(/Connecting…/)).not.toBeInTheDocument());
  });
});

describe('Save data setting', () => {
  it('remembers the choice on this phone, with only Automatic and Off — never a manual tap-to-download option', () => {
    render(<DataSaverSetting />);
    expect(screen.getByLabelText(/Automatic/)).toBeChecked();
    expect(screen.queryByLabelText(/Always save data/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Off/));
    expect(localStorage.getItem('dataSaver')).toBe('off');
  });
});
