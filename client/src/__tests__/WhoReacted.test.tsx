import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

// Posts: tapping "👍❤️ 3" shows who reacted with what; everyone's
// reactions add up by themselves (the feed refreshes the counts), and the
// count after my own reaction includes the others'.
const PERSON_A = '11111111-1111-1111-1111-111111111111';
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

const POST = {
  id: PERSON_A,
  author: { personId: 'p-ada', name: 'Ada Obi', photoUrl: null },
  body: 'Sunday service photos',
  youtubeVideoId: null,
  createdAt: '2026-10-05T08:00:00.000Z',
  photos: [],
  reactionCounts: { LIKE: 1, LOVE: 1 },
  myReaction: null,
  commentCount: 0,
  canDelete: false,
};
const FEED = { viewer: { canPost: true, canModerate: false, personId: 'p-me' }, items: [POST], nextBefore: null };

describe('Who reacted to a post', () => {
  it('lists everyone with their reaction, with a tab per reaction', async () => {
    mockFetch({
      'GET /api/updates/': () => ({ body: {} }),
      'GET /api/updates': () => ({ body: FEED }),
      [`GET /api/updates/${POST.id}/reactions`]: () => ({
        body: {
          total: 2,
          items: [
            { personId: 'p1', name: 'Grace Mbah', photoUrl: null, reaction: 'LOVE', isMe: false },
            { personId: 'p2', name: 'Paul Ndi', photoUrl: null, reaction: 'LIKE', isMe: false },
          ],
        },
      }),
    });
    render(<UpdatesFeed showComposer={false} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 reactions — see who' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reactions' });
    expect(await within(sheet).findByText('Grace Mbah')).toBeInTheDocument();
    expect(within(sheet).getByText('Paul Ndi')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('tab', { name: '❤️ 1' }));
    expect(within(sheet).queryByText('Paul Ndi')).not.toBeInTheDocument();
    expect(within(sheet).getByText('Grace Mbah')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Reactions' })).not.toBeInTheDocument();
  });

  it('my like adds to the others’ (the server’s full count), and new reactions from others appear by themselves', async () => {
    let counts: Record<string, number> = { LIKE: 1, LOVE: 1 };
    mockFetch({
      'GET /api/updates': () => ({ body: FEED }),
      [`PUT /api/updates/${POST.id}/reaction`]: () => {
        // Someone else liked it meanwhile too.
        counts = { LIKE: 3, LOVE: 1 };
        return { body: { reactionCounts: counts, myReaction: 'LIKE' } };
      },
      'GET /api/updates/reaction-counts': () => ({ body: { items: { [POST.id]: { reactionCounts: { ...counts, PRAY: 1 }, myReaction: 'LIKE' } } } }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<UpdatesFeed showComposer={false} />);
    expect(await screen.findByText('👍❤️ 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '👍 React' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Like' }));
    expect(await screen.findByText('👍❤️ 4')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(31000);
    });
    await waitFor(() => expect(screen.getByText('👍❤️🙏 5')).toBeInTheDocument());
    expect(calls.some((c) => c.url.startsWith(`/api/updates/reaction-counts?ids=${POST.id}`))).toBe(true);
  });
});
