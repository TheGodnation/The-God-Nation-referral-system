import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAuthProvider, useMemberAuth } from '../lib/MemberAuthContext';
import { MemberPrivateChatPage } from '../pages/MemberPrivateChatPage';
import { MemberDownloadsPage } from '../pages/MemberDownloadsPage';
import { PrivateChatList } from '../components/chat/PrivateChatList';
import { useAttachmentUrl } from '../lib/chatMedia';
import { clearChatCache, loadThread, saveThread, THREADS_KEPT, THREAD_MESSAGES } from '../lib/chatCache';
import { clearMedia, deleteAllFor, getFile, listSaved, mediaKey, mediaUsage, saveMedia, MEDIA_FILE_MAX_BYTES, MEDIA_LIMIT_BYTES } from '../lib/offlineStore';
import type { ChatMessage } from '../components/chat/types';

// Private chats without internet: the last messages of each chat and the chat list are kept on the phone, and photos and
// voice notes seen or heard are kept within a size limit (oldest removed first, big files and videos never kept).
let online = true;
let n = 0;
let personId = '';
const me = () => ({ member: { name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId, profileComplete: true } });

function mockFetch(routes: Record<string, () => { status?: number; body?: unknown; blob?: Blob }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (!online) throw new TypeError('Failed to fetch');
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => {
        const [m, path] = k.split(' ');
        return m === method && url.startsWith(path);
      });
      const res = key ? routes[key]() : { status: 404, body: {} };
      const status = res.status ?? 200;
      return { ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body, blob: async () => res.blob ?? new Blob([]) };
    }),
  );
}

beforeEach(() => {
  n += 1;
  personId = `off${n}`;
  online = true;
  window.scrollTo = vi.fn() as any;
  (URL as any).createObjectURL = vi.fn(() => `blob:test-${Math.random()}`);
  (URL as any).revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const msg = (i: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: `m${i}`, senderName: 'Grace', isOwn: false, body: `Message ${i}`, createdAt: new Date(2026, 0, 1, 10, i).toISOString(), deleted: false, attachments: [], ...over }) as ChatMessage;

describe('Kept messages (chatCache)', () => {
  it('keeps the last 50 messages of a chat, without messages still waiting to be sent', () => {
    const many = Array.from({ length: 80 }, (_, i) => msg(i));
    saveThread(personId, 'c1', { name: 'Grace' }, [...many, msg(900, { pending: true }), msg(901, { queued: true } as any)]);
    const kept = loadThread<{ name: string }>(personId, 'c1')!;
    expect(kept.messages).toHaveLength(THREAD_MESSAGES);
    expect(kept.messages[kept.messages.length - 1].id).toBe('m79');
    expect(kept.messages.some((m) => m.id === 'm900' || m.id === 'm901')).toBe(false);
    expect(kept.other.name).toBe('Grace');
  });

  it('keeps only the 20 chats used most recently, and nothing for another member', () => {
    for (let i = 0; i < THREADS_KEPT + 5; i += 1) saveThread(personId, `chat${i}`, {}, [msg(i)]);
    const alive = Array.from({ length: THREADS_KEPT + 5 }, (_, i) => i).filter((i) => loadThread(personId, `chat${i}`));
    expect(alive).toHaveLength(THREADS_KEPT);
    expect(loadThread('someone-else', 'chat24')).toBeNull();
  });

  it('is removed when the member signs out or deletes their account', async () => {
    saveThread(personId, 'c1', {}, [msg(1)]);
    localStorage.setItem(`godnation:chatlist:${personId}`, '{}');
    await deleteAllFor(personId);
    expect(loadThread(personId, 'c1')).toBeNull();
    expect(localStorage.getItem(`godnation:chatlist:${personId}`)).toBeNull();
    clearChatCache(personId);
  });

  it('keeps nothing when the browser refuses storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveThread(personId, 'c1', {}, [msg(1)])).not.toThrow();
    setItem.mockRestore();
  });
});

describe('Kept photos and voice notes: size limits', () => {
  const blob = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('states the limits: 100 MB in all, 10 MB for one file', () => {
    expect(MEDIA_LIMIT_BYTES).toBe(100 * 1024 * 1024);
    expect(MEDIA_FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('keeps a file, and not one that is too big', async () => {
    const limits = { total: 1000, file: 400 };
    expect(await saveMedia(personId, 'a1', blob(300), 'image/jpeg', limits)).toBe(true);
    expect((await getFile(mediaKey(personId, 'a1')))?.blob.size).toBe(300);
    expect(await saveMedia(personId, 'big', blob(401), 'image/jpeg', limits)).toBe(false);
    expect(await getFile(mediaKey(personId, 'big'))).toBeNull();
    expect(await mediaUsage(personId)).toEqual({ count: 1, bytes: 300 });
  });

  it('removes the oldest first when the total would pass the limit', async () => {
    const limits = { total: 1000, file: 400 };
    for (const id of ['a', 'b', 'c']) {
      await saveMedia(personId, id, blob(300), 'image/jpeg', limits);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await mediaUsage(personId)).bytes).toBe(900);
    await saveMedia(personId, 'd', blob(300), 'image/jpeg', limits);
    expect(await getFile(mediaKey(personId, 'a'))).toBeNull();
    for (const id of ['b', 'c', 'd']) expect(await getFile(mediaKey(personId, id))).not.toBeNull();
    expect((await mediaUsage(personId)).bytes).toBeLessThanOrEqual(1000);
  });

  it('"Clear" removes photos and voice notes but not PDFs or books', async () => {
    await saveMedia(personId, 'a', blob(100), 'image/jpeg');
    const { saveFile } = await import('../lib/offlineStore');
    await saveFile({ key: `${personId}:doc:d1`, ownerId: personId, kind: 'DOC', title: 'x.pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) });
    await clearMedia(personId);
    const left = await listSaved(personId);
    expect(left.map((r) => r.kind)).toEqual(['DOC']);
  });
});

function Probe({ keep = true }: { keep?: boolean }) {
  const { url, failed } = useAttachmentUrl('/api/private-messages/conversations/c1', 'm1', 'att1', true, keep ? { mime: 'image/jpeg', byteSize: 5 } : undefined);
  return <p data-testid="probe">{failed ? 'failed' : url ?? 'loading'}</p>;
}
// In the app, pages only open once the member is known (RequireMember); the tests wait for that too.
function Gate({ children }: { children: React.ReactNode }) {
  const { member } = useMemberAuth();
  return member ? <>{children}</> : null;
}
const withMember = (ui: React.ReactNode) => (
  <MemoryRouter>
    <MemberAuthProvider>
      <Gate>{ui}</Gate>
    </MemberAuthProvider>
  </MemoryRouter>
);

describe('A photo or voice note seen once shows again without internet', () => {
  it('is fetched once, kept, and then shown from the kept copy when offline', async () => {
    const bytes = new Blob([new Uint8Array(5)], { type: 'image/jpeg' });
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/private-messages/conversations/c1/messages/m1/attachments/att1/download-url': () => ({ body: { url: 'https://storage.example/att1' } }),
      'GET https://storage.example/att1': () => ({ blob: bytes }),
    });
    const first = render(withMember(<Probe />));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^blob:/));
    await waitFor(async () => expect(await getFile(mediaKey(personId, 'att1'))).not.toBeNull());
    first.unmount();

    online = false;
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: me() }) });
    online = true;
    // Offline now: only the kept copy can answer.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/member/auth/me')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => me() };
      throw new TypeError('Failed to fetch');
    }));
    render(withMember(<Probe />));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^blob:/));
  });

  it('falls back to the plain link when the file cannot be fetched as a file', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/private-messages/conversations/c1/messages/m1/attachments/att1/download-url': () => ({ body: { url: 'https://storage.example/att1' } }),
      'GET https://storage.example/att1': () => ({ status: 403 }),
    });
    render(withMember(<Probe />));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('https://storage.example/att1'));
  });

  it('never keeps a file bigger than the single-file limit (it is shown from the link)', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: me() }),
      'GET /api/private-messages/conversations/c1/messages/m1/attachments/att1/download-url': () => ({ body: { url: 'https://storage.example/att1' } }),
    });
    function Big() {
      const { url } = useAttachmentUrl('/api/private-messages/conversations/c1', 'm1', 'att1', true, { mime: 'image/jpeg', byteSize: MEDIA_FILE_MAX_BYTES + 1 });
      return <p data-testid="probe">{url ?? 'loading'}</p>;
    }
    render(withMember(<Big />));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('https://storage.example/att1'));
    expect(await getFile(mediaKey(personId, 'att1'))).toBeNull();
  });
});

describe('A private chat opens without internet', () => {
  const MESSAGES = {
    items: [
      { id: 'm1', isOwn: false, body: 'Are you coming to the prayer?', createdAt: new Date().toISOString(), attachments: [], replyTo: null, reactions: [] },
      { id: 'm2', isOwn: true, body: 'Yes, I will', createdAt: new Date().toISOString(), attachments: [], replyTo: null, reactions: [] },
    ],
    hasMore: false,
    unreadCount: 0,
    otherPartyType: 'MEMBER',
    otherPartyName: 'Grace Ngwa',
    otherPartyPersonId: 'p2',
  };
  const renderChat = () =>
    render(
      <MemoryRouter initialEntries={['/member/chats/private/c1']}>
        <MemberAuthProvider>
          <Gate>
            <Routes>
              <Route path="/member/chats/private/:conversationId" element={<MemberPrivateChatPage />} />
            </Routes>
          </Gate>
        </MemberAuthProvider>
      </MemoryRouter>,
    );

  it('shows the last messages kept on the phone, with a note, and the real ones when the connection is back', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: me() }), 'GET /api/private-messages/conversations/c1/messages': () => ({ body: MESSAGES }) });
    const first = renderChat();
    expect(await screen.findByText('Are you coming to the prayer?')).toBeInTheDocument();
    // The copy is kept a moment after the messages arrive.
    await waitFor(() => expect(loadThread(personId, 'c1')?.messages).toHaveLength(2), { timeout: 4000 });
    first.unmount();

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/member/auth/me')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => me() };
      throw new TypeError('Failed to fetch');
    }));
    renderChat();
    expect(await screen.findByText('Are you coming to the prayer?')).toBeInTheDocument();
    expect(screen.getByText('Yes, I will')).toBeInTheDocument();
    expect(screen.getByTestId('offline-copy')).toHaveTextContent('No internet');
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });

  it('shows the usual "could not load" message when nothing was kept', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/member/auth/me')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => me() };
      throw new TypeError('Failed to fetch');
    }));
    renderChat();
    await waitFor(() => expect(screen.queryByTestId('offline-copy')).toBeNull());
    await screen.findByRole('button', { name: /try again/i });
  });
});

describe('The chat list and the Downloads page', () => {
  it('the chat list is shown from the kept copy when offline', async () => {
    const row = { id: 'c1', createdAt: new Date().toISOString(), otherPartyType: 'MEMBER', otherPartyName: 'Grace Ngwa', unreadCount: 0, lastMessage: { body: 'See you', attachmentMimeType: null, isOwn: false, createdAt: new Date().toISOString() } };
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: me() }), 'GET /api/private-messages/conversations': () => ({ body: { items: [row] } }) });
    const first = render(withMember(<PrivateChatList />));
    expect(await screen.findByText('Grace Ngwa')).toBeInTheDocument();
    first.unmount();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/member/auth/me')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => me() };
      throw new TypeError('Failed to fetch');
    }));
    render(withMember(<PrivateChatList />));
    expect(await screen.findByText('Grace Ngwa')).toBeInTheDocument();
  });

  it('the Downloads page shows the limit and how much is kept, and can clear it', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: me() }) });
    await saveMedia(personId, 'a1', new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }), 'image/jpeg');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(withMember(<MemberDownloadsPage />));
    const usage = await screen.findByTestId('downloads-media-usage');
    await waitFor(() => expect(usage).toHaveTextContent('1 kept'));
    expect(screen.getByTestId('downloads-media')).toHaveTextContent('Never more than 100 MB');
    fireEvent.click(screen.getByTestId('downloads-media-clear'));
    await waitFor(() => expect(screen.getByTestId('downloads-media-usage')).toHaveTextContent('None kept yet.'));
  });
});
