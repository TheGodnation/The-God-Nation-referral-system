import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

function mockFeed(items: unknown[], extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  const calls: { url: string; method: string; body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(extra).find((k) => {
        const [m, path] = k.split(' ');
        return m === method && url.startsWith(path);
      });
      const res = key
        ? extra[key](body)
        : method === 'GET' && url.startsWith('/api/updates')
          ? { body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items, nextBefore: null } }
          : { status: 404, body: {} };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

function post(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    author: { personId: 'p1', name: 'Ada Obi', photoUrl: null },
    body: 'Hello family',
    youtubeVideoId: null,
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    photos: [],
    reactionCounts: {},
    myReaction: null,
    commentCount: 0,
    canDelete: false,
    ...over,
  };
}

describe('Updates wall', () => {
  it('shows a friendly time like "5 min"', async () => {
    mockFeed([post()]);
    render(<UpdatesFeed wall />);
    const card = await screen.findByRole('article', { name: 'Post by Ada Obi' });
    expect(within(card).getByText(/5 min/)).toBeInTheDocument();
  });

  it('shows several photos in the post and opens them full screen, with next/previous', async () => {
    const photos = [1, 2, 3].map((n) => ({ id: `ph${n}`, url: `/api/updates/photos/ph${n}` }));
    mockFeed([post({ photos })]);
    render(<UpdatesFeed wall />);
    const tiles = await screen.findAllByRole('button', { name: 'Open photo' });
    expect(tiles).toHaveLength(3);
    fireEvent.click(tiles[1]);
    const viewer = screen.getByRole('dialog', { name: 'Photo' });
    expect(within(viewer).getByText('2 / 3')).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Next photo' }));
    expect(within(viewer).getByText('3 / 3')).toBeInTheDocument();
    expect(within(viewer).queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when a photo cannot be shown, instead of a broken picture', async () => {
    mockFeed([post({ photos: [{ id: 'ph1', url: '/api/updates/photos/ph1' }] })]);
    render(<UpdatesFeed wall />);
    const tile = await screen.findByRole('button', { name: 'Open photo' });
    fireEvent.error(tile.querySelector('img')!);
    expect(await within(tile).findByText("This photo can't be shown right now.")).toBeInTheDocument();
  });

  it('long posts are shortened with "See more"', async () => {
    mockFeed([post({ body: 'Word '.repeat(120) })]);
    render(<UpdatesFeed wall />);
    fireEvent.click(await screen.findByRole('button', { name: 'See more' }));
    expect(screen.getByRole('button', { name: 'See less' })).toBeInTheDocument();
  });

  it('shows picked photos in the write box and lets you remove one', async () => {
    mockFeed([]);
    render(<UpdatesFeed wall />);
    await screen.findByLabelText('Write a post');
    const input = screen.getByLabelText('Photos', { selector: 'input' });
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [a, b] } });
    expect(await screen.findByRole('button', { name: 'Remove a.jpg' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.jpg' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove a.jpg' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove b.png' })).toBeInTheDocument();
  });

  it('refuses more than 4 photos', async () => {
    mockFeed([]);
    render(<UpdatesFeed wall />);
    await screen.findByLabelText('Write a post');
    const files = [1, 2, 3, 4, 5].map((n) => new File(['x'], `${n}.jpg`, { type: 'image/jpeg' }));
    fireEvent.change(screen.getByLabelText('Photos', { selector: 'input' }), { target: { files } });
    expect(await screen.findByRole('alert')).toHaveTextContent('You can add up to 4 photos.');
  });
});
