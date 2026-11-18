import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SplitChatsCard } from '../components/admin/SplitChatsCard';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
const ITEM = { keepId: 'k1', dropId: 'd1', personA: { id: 'a', name: 'Grace Mbah' }, personB: { id: 'b', name: 'Paul Ndi' }, keepMessages: 12, dropMessages: 3, keepStarted: '2026-01-01T10:00:00Z', dropStarted: '2026-06-01T10:00:00Z', lastMessageAt: '2026-06-02T10:00:00Z' };

afterEach(() => vi.unstubAllGlobals());

describe('Join split chats card', () => {
  it('lists the split pairs when opened and joins one after confirming', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return json({ ok: true, movedMessages: 3 }); }
      return json({ items: [ITEM] });
    }));
    render(<SplitChatsCard base="/api/admin/cells" />);
    const details = screen.getByTestId('split-chats') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await screen.findByText('Grace Mbah ⇄ Paul Ndi');
    fireEvent.click(screen.getByTestId('split-join-k1'));
    await waitFor(() => expect(screen.getByTestId('split-done')).toBeInTheDocument());
    expect(posts).toEqual([{ keepId: 'k1', dropId: 'd1' }]);
    expect(screen.queryByTestId('split-k1')).toBeNull();
  });

  it('says so when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [] })));
    render(<SplitChatsCard base="/api/admin/cells" />);
    const details = screen.getByTestId('split-chats') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByTestId('split-none')).toBeInTheDocument();
  });
});
