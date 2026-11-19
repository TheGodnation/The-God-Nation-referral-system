import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';

// "Unread" in an assembly goes down only as the messages are really seen on the screen, not the moment the chat is opened:
// a member who arrives with new messages keeps their number on the Chats page until they have scrolled through them.
const G = 'g1';
const calls: { url: string; method: string; body: any }[] = [];
let observers: { cb: IntersectionObserverCallback; els: Element[] }[] = [];

class FakeIO {
  entry: { cb: IntersectionObserverCallback; els: Element[] };
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, els: [] };
    observers.push(this.entry);
  }
  observe(el: Element) { this.entry.els.push(el); }
  unobserve() {}
  disconnect() { observers = observers.filter((o) => o !== this.entry); }
  takeRecords() { return []; }
}

const msg = (id: string, minute: number, own = false) => ({
  id, senderName: own ? 'Me Myself' : `Sender ${id}`, senderPersonId: `p-${id}`, isOwn: own, body: `Message ${id}`,
  createdAt: new Date(Date.UTC(2026, 10, 18, 10, minute)).toISOString(), deleted: false, attachments: [], replyTo: null, reactions: [],
});
// m1 was read before; m2..m5 (4 messages from others) are new.
const items = [msg('m1', 0), msg('m2', 1), msg('m3', 2), msg('m4', 3), msg('m5', 4)];

function mock() {
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    let body: unknown = {};
    if (url.includes('/community-memberships')) body = { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] };
    else if (method === 'GET' && url.includes(`/api/communities/${G}/conversation/messages`)) body = { items, hasMore: false, unreadCount: 4, isAdministrator: false, canPost: true };
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
  }));
}
const reads = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/conversation/read')).map((c) => c.body.messageId);

/** The screen shows these messages now. */
function see(...ids: string[]) {
  act(() => {
    for (const o of observers) {
      const els = o.els.filter((e) => ids.includes((e as HTMLElement).dataset.mid ?? ''));
      if (els.length) o.cb(els.map((target) => ({ isIntersecting: true, target } as unknown as IntersectionObserverEntry)), {} as IntersectionObserver);
    }
  });
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
      <Routes>
        <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { observers = []; calls.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('unread in an assembly goes down only as messages are seen', () => {
  it('does not mark anything read just because the chat was opened, or because only the newest messages were on screen', async () => {
    mock();
    renderChat();
    await screen.findByText('Message m5');
    see('m4', 'm5'); // only the bottom of the unread block is on screen
    await new Promise((r) => setTimeout(r, 700));
    expect(reads()).toEqual([]);
  });

  it('marks read up to the last message seen, in order, and everything once all of them were seen', async () => {
    mock();
    renderChat();
    await screen.findByText('Message m5');
    see('m2', 'm3');
    await waitFor(() => expect(reads()).toEqual(['m3']), { timeout: 2000 });
    see('m4', 'm5');
    await waitFor(() => expect(reads()).toEqual(['m3', 'm5']), { timeout: 2000 });
  });

  it('shows a Latest button that skips ahead and marks everything read', async () => {
    mock();
    renderChat();
    await screen.findByText('Message m5');
    // The chat opened at the first new message (more than a screenful of new ones), so the button is there.
    const jump = await screen.findByTestId('jump-latest');
    act(() => jump.click());
    await waitFor(() => expect(reads()).toEqual(['m5']));
  });
});
