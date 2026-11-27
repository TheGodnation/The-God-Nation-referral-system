import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import { MemberPrivateChatPage } from '../pages/MemberPrivateChatPage';

// Older messages open by themselves as the member scrolls up a chat: no "Load older messages" tap, and no limit — page after page
// keeps coming while there is more.

const calls: string[] = [];
function mockFetch(routes: Record<string, () => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key]() : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

// A chat that fills the screen: 2000 px of messages in a 600 px view.
const sizes = { scrollHeight: 2000, clientHeight: 600 };
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => sizes.clientHeight });
  sizes.scrollHeight = 2000;
  sizes.clientHeight = 600;
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  delete (HTMLElement.prototype as any).scrollHeight;
  delete (HTMLElement.prototype as any).clientHeight;
});

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const msg = (id: string, body: string, min: number) => ({ id, senderName: 'Ada Nkem', senderPersonId: 'p-ada', isOwn: false, body, createdAt: ago(min), deleted: false, attachments: [], replyTo: null, reactions: [] });
const pm = (id: string, body: string, min: number) => ({ id, isOwn: false, body, createdAt: ago(min), attachments: [], replyTo: null, reactions: [] });

const G = 'g1';
const scroller = () => document.querySelector('[aria-live="polite"]') as HTMLElement;
function scrollTo(top: number) {
  const el = scroller();
  el.scrollTop = top;
  fireEvent.scroll(el);
}

describe('older messages open by themselves when scrolling up', () => {
  it('in a group or assembly: page after page, with no button to tap', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
      [`GET /api/communities/${G}/conversation/messages`]: () => ({ body: { items: [msg('m3', 'Newest message', 1)], hasMore: true, unreadCount: 0, isAdministrator: false, canPost: true } }),
      [`GET /api/communities/${G}/conversation/messages?before=m3`]: () => ({ body: { items: [msg('m2', 'Older message', 60)], hasMore: true } }),
      [`GET /api/communities/${G}/conversation/messages?before=m2`]: () => ({ body: { items: [msg('m1', 'Oldest message', 600)], hasMore: false } }),
    });
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Newest message')).toBeInTheDocument();
    scrollTo(1400); // reading at the bottom: nothing more is asked for
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.includes('before='))).toBe(false);
    scrollTo(100); // near the top
    expect(await screen.findByText('Older message')).toBeInTheDocument();
    scrollTo(50); // keeps going up
    expect(await screen.findByText('Oldest message')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('load-older')).toBeNull()); // nothing older left
    scrollTo(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.includes('before='))).toHaveLength(2); // never asked twice for the same page
  });

  it('in a group whose messages do not fill the screen: older ones come by themselves until it does', async () => {
    sizes.scrollHeight = 500; // shorter than the 600 px view: cannot scroll at all
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
      [`GET /api/communities/${G}/conversation/messages`]: () => ({ body: { items: [msg('m3', 'Newest message', 1)], hasMore: true, unreadCount: 0, isAdministrator: false, canPost: true } }),
      [`GET /api/communities/${G}/conversation/messages?before=m3`]: () => ({ body: { items: [msg('m2', 'Older message', 60)], hasMore: false } }),
    });
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Older message')).toBeInTheDocument();
  });

  it('in a private chat too', async () => {
    const BASE = '/api/private-messages/conversations/c1';
    mockFetch({
      [`GET ${BASE}/messages`]: () => ({
        body: { items: [pm('p3', 'Latest private', 1)], hasMore: true, unreadCount: 0, otherPartyType: 'MEMBER', otherPartyName: 'Grace Ngwa', otherPartyPersonId: 'p2', otherPartyPhotoUrl: null },
      }),
      [`GET ${BASE}/messages?before=p3`]: () => ({ body: { items: [pm('p2', 'Earlier private', 90)], hasMore: false } }),
    });
    render(
      <MemoryRouter initialEntries={['/member/chats/private/c1']}>
        <Routes>
          <Route path="/member/chats/private/:conversationId" element={<MemberPrivateChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Latest private')).toBeInTheDocument();
    scrollTo(80);
    expect(await screen.findByText('Earlier private')).toBeInTheDocument();
  });
});
