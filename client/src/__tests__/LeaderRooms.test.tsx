import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeaderRoomsPanel } from '../components/admin/LeaderRoomsPanel';

// The National Coordinator in the leaders' rooms: pick "All leaders" or a generation, read it, write to every leader
// of that level; messages from the National Coordinator carry a badge.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const ROOMS = [
  { generation: -1, leaders: 4, unreadCount: 2, lastMessageAt: '2026-11-06T10:00:00Z' },
  { generation: 0, leaders: 1, unreadCount: 0, lastMessageAt: null },
  { generation: 1, leaders: 2, unreadCount: 0, lastMessageAt: null },
];

describe('The leaders\' rooms for the National Coordinator', () => {
  it('lists All leaders and each generation with the number of leaders, and opens a room', async () => {
    const calls: { url: string; method: string; body?: any }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === 'POST' && url.endsWith('/-1/messages')) return json({ id: 'm9', notified: 4 }, 201);
      if (url.endsWith('/-1/messages')) return json({ items: [
        { id: 'm1', senderName: 'National Coordinator', senderBadge: 'NATIONAL_COORDINATOR', body: 'To all leaders.', createdAt: '2026-11-06T10:00:00Z' },
        { id: 'm2', senderName: 'Leader B', senderBadge: null, body: 'Understood.', createdAt: '2026-11-06T10:05:00Z' },
      ], hasMore: false, unreadCount: 0 });
      if (url.endsWith('/-1/read')) return json({ unreadCount: 0 });
      return json({ items: ROOMS, canWrite: true });
    }));
    render(<LeaderRoomsPanel base="/api/member/central-leader-rooms" />);
    expect(await screen.findByTestId('room--1')).toHaveTextContent('All leaders');
    expect(screen.getByTestId('room--1')).toHaveTextContent('4 leader(s)');
    expect(screen.getByTestId('room--1')).toHaveTextContent('2');
    expect(screen.getByTestId('room-0')).toHaveTextContent('Founding generation (0)');
    expect(screen.getByTestId('room-1')).toHaveTextContent('Generation 1');

    fireEvent.click(screen.getByTestId('room--1'));
    expect(await screen.findByText('To all leaders.')).toBeInTheDocument();
    // Only the National Coordinator's own message carries the badge.
    expect(screen.getAllByText('National Coordinator').length).toBeGreaterThanOrEqual(2); // the sender name and the badge
    expect(screen.getByText('Understood.')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/member/central-leader-rooms/-1/messages')).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Report by Friday.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/-1/messages') && c.body?.body === 'Report by Friday.')).toBe(true));
  });

  it('says so when the admin has no member profile yet, and when there is no leader', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [], canWrite: false })));
    render(<LeaderRoomsPanel base="/api/admin/leader-rooms" />);
    expect(await screen.findByText('To write here, create your member profile first. You can read the rooms meanwhile.')).toBeInTheDocument();
    expect(screen.getByText('No leader yet, so no room yet.')).toBeInTheDocument();
  });
});
