import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
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
      const res = key ? routes[key](body) : { status: 404, body: {} };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const now = new Date().toISOString();
const POST = {
  id: 'u1',
  author: { personId: 'p1', name: 'Ada Obi', photoUrl: null },
  body: 'Prayer meeting tonight',
  youtubeVideoId: null,
  createdAt: now,
  photos: [],
  reactionCounts: {},
  myReaction: null,
  commentCount: 3,
  canDelete: false,
};
const COMMENTS = [
  { id: 'c1', parentCommentId: null, author: { personId: 'p1', name: 'Ada Obi', photoUrl: null }, body: 'Who is coming?', createdAt: now, reactionCounts: { LIKE: 2, PRAY: 1 }, myReaction: 'LIKE', canDelete: false },
  { id: 'c2', parentCommentId: 'c1', author: { personId: 'p2', name: 'Ben Tabe', photoUrl: null }, body: 'I am coming', createdAt: now, reactionCounts: {}, myReaction: null, canDelete: false },
];

function routes(extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  return {
    'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items: [POST], nextBefore: null } }),
    'GET /api/updates/u1/comments': () => ({ body: { items: COMMENTS } }),
    ...extra,
  };
}

async function openComments() {
  const card = await screen.findByRole('article', { name: 'Post by Ada Obi' });
  fireEvent.click(within(card).getByRole('button', { name: /Comment$/ }));
  return card;
}

describe('Comments with likes and replies', () => {
  it('shows reaction counts and puts replies under the comment they answer', async () => {
    mockFetch(routes());
    render(<UpdatesFeed wall />);
    await openComments();
    const top = await screen.findByRole('group', { name: 'Comment by Ada Obi' });
    expect(within(top).getByText('👍🙏 3')).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: /👍 Like/ })).toBeInTheDocument();
    const reply = screen.getByRole('group', { name: 'Comment by Ben Tabe' });
    expect(reply.parentElement).toHaveClass('ml-10');
  });

  it('react to a comment with one of the six reactions', async () => {
    mockFetch(
      routes({
        'PUT /api/updates/comments/c2/reaction': () => ({ body: { reactionCounts: { LOVE: 1 }, myReaction: 'LOVE' } }),
      }),
    );
    render(<UpdatesFeed wall />);
    await openComments();
    const reply = await screen.findByRole('group', { name: 'Comment by Ben Tabe' });
    fireEvent.click(within(reply).getByRole('button', { name: 'Like' }));
    fireEvent.click(within(reply).getByRole('menuitem', { name: 'Love' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ type: 'LOVE' }));
    expect(await within(reply).findByText('❤️ 1')).toBeInTheDocument();
  });

  it('reply to a comment', async () => {
    mockFetch(routes({ 'POST /api/updates/u1/comments': () => ({ status: 201, body: { id: 'c3', parentCommentId: 'c1' } }) }));
    render(<UpdatesFeed wall />);
    await openComments();
    const top = await screen.findByRole('group', { name: 'Comment by Ada Obi' });
    fireEvent.click(within(top).getByRole('button', { name: 'Reply' }));
    expect(screen.getByText('Replying to Ada Obi')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reply to Ada Obi'), { target: { value: 'Me too' } });
    fireEvent.submit(screen.getByLabelText('Reply to Ada Obi').closest('form')!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ body: 'Me too', parentCommentId: 'c1' }),
    );
  });
});
