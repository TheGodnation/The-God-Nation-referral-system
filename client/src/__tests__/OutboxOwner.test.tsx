import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOutbox, clearAllOutboxes, dropUnownedOutboxes, outboxStorageKey } from '../lib/chatSync';
import type { ChatMessage } from '../components/chat/types';

// A message typed offline waits on the phone. On a shared phone it must stay with the member who typed it:
// never shown to, nor sent from, the next person's account, and gone once its writer signs out.

const temp = (id: string, body: string): ChatMessage => ({
  id,
  senderName: 'You',
  isOwn: true,
  body,
  createdAt: '2026-11-16T10:00:00Z',
  deleted: false,
  attachments: [],
});


beforeEach(() => {
  localStorage.clear();
});
afterEach(() => localStorage.clear());

function queueAs(ownerId: string, body: string) {
  const { result, unmount } = renderHook(() => useOutbox(ownerId, 'private:c1', () => new Promise<void>(() => {}), () => {}, () => {}));
  act(() => result.current.enqueue('pending-1', { body } as never, temp('pending-1', body)));
  unmount();
}

describe('Messages waiting for network belong to the member who wrote them', () => {
  it('keeps them under the writer, so another member on the same phone never sees or sends them', () => {
    queueAs('grace', 'Grace typed this offline');
    expect(localStorage.getItem(outboxStorageKey('grace', 'private:c1'))).toContain('Grace typed this offline');

    const send = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useOutbox('paul', 'private:c1', send, () => {}, () => {}));
    expect(result.current.queued).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the writer their own waiting message again when they come back', () => {
    queueAs('grace', 'Still waiting');
    const { result } = renderHook(() => useOutbox('grace', 'private:c1', () => new Promise<void>(() => {}), () => {}, () => {}));
    expect(result.current.queued.map((q) => q.message.body)).toEqual(['Still waiting']);
  });

  it('switches to the new member\'s own list when the signed-in member changes', () => {
    queueAs('grace', 'From Grace');
    let owner = 'grace';
    const { result, rerender } = renderHook(() => useOutbox(owner, 'private:c1', () => new Promise<void>(() => {}), () => {}, () => {}));
    expect(result.current.queued).toHaveLength(1);
    owner = 'paul';
    rerender();
    expect(result.current.queued).toHaveLength(0);
  });

  it('signing out removes every waiting message from the phone', () => {
    queueAs('grace', 'One');
    localStorage.setItem('outbox:group:g1', '[]');
    localStorage.setItem('draft:keep', 'x');
    clearAllOutboxes();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('outbox:'))).toEqual([]);
    expect(localStorage.getItem('draft:keep')).toBe('x');
  });

  it('drops waiting messages saved before they had an owner, and keeps the owned ones', () => {
    localStorage.setItem('outbox:private:c1', JSON.stringify([{ tempId: 't', out: { body: 'old' }, message: temp('t', 'old') }]));
    localStorage.setItem('outbox:group:g1', '[]');
    queueAs('grace', 'Mine');
    dropUnownedOutboxes();
    expect(localStorage.getItem('outbox:private:c1')).toBeNull();
    expect(localStorage.getItem('outbox:group:g1')).toBeNull();
    expect(localStorage.getItem(outboxStorageKey('grace', 'private:c1'))).toContain('Mine');
  });
});
