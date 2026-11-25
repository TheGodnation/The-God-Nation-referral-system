import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import { refreshAfterSend } from '../lib/chatRefresh';

// A message that was posted must not seem to vanish when the follow-up request for new messages fails on a slow connection.
describe('refreshAfterSend', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks again, a little later each time, until a request works', async () => {
    let calls = 0;
    let failed = true;
    const refresh = vi.fn(async () => {
      calls += 1;
      failed = calls < 3;
    });
    const done = refreshAfterSend(refresh, () => failed);
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('asks once only when the first request works, even if it found nothing new', async () => {
    const refresh = vi.fn(async () => {});
    await refreshAfterSend(refresh, () => false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few tries', async () => {
    const refresh = vi.fn(async () => {});
    const done = refreshAfterSend(refresh, () => true);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});

describe('Sending a voice note or photo when the connection is poor', () => {
  const G = 'g1';
  afterEach(() => vi.unstubAllGlobals());

  class FakeXhr {
    upload = { onprogress: null as null | (() => void) };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.onload?.());
    }
    abort() {}
  }

  it('keeps the note showing until the chat has it, even when the first refresh after sending fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    let posted = false;
    let getsAfterPost = 0;
    const note = { id: 'n1', senderName: 'Me', isOwn: true, body: null, createdAt: new Date().toISOString(), deleted: false, attachments: [{ id: 'a1', originalFilename: 'v.webm', mimeType: 'audio/webm', byteSize: 4, durationMs: 4000 }], replyTo: null, reactions: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
        if (url.includes('community-memberships')) return ok({ items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] });
        if (url.includes('/attachments/authorize')) return ok({ storageKey: 'k1', uploadUrl: 'https://storage.example/put' });
        if (method === 'POST' && url.endsWith('/conversation/messages')) {
          posted = true;
          return ok({ id: 'n1' });
        }
        if (method === 'GET' && url.includes('/conversation/messages')) {
          if (posted) {
            getsAfterPost += 1;
            // The first request after sending dies on the poor connection; the next one works.
            if (getsAfterPost === 1) return Promise.reject(new TypeError('Failed to fetch'));
          }
          return ok({ items: posted ? [note] : [], hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true });
        }
        return ok({});
      }),
    );
    render(
      <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
        <Routes>
          <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Emojis' });
    const input = screen.getByTestId('chat-gallery-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'church.png', { type: 'image/png' })] } });
    const send = await screen.findByRole('button', { name: /^Send/ });
    await act(async () => {
      fireEvent.click(send);
    });
    // The first refresh failed, so the sending bubble must still be there; then the retry brings the real message.
    await waitFor(() => expect(getsAfterPost).toBeGreaterThanOrEqual(1));
    expect(document.querySelector('[data-testid="uploading-bubble"]')).not.toBeNull(); // not gone while the chat does not have it yet
    expect(document.querySelector('[data-mid="n1"]')).toBeNull();
    await waitFor(() => expect(getsAfterPost).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('[data-mid="n1"]')).not.toBeNull(), { timeout: 5000 });
  });
});
