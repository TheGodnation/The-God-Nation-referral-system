import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';
import { LiveBanner } from '../components/updates/LiveBanner';
import { AdminLiveControl } from '../components/updates/AdminLiveControl';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (method: string, body: any) => { status?: number; body: unknown }>) {
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
      const res = key ? routes[key](method, body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

const POST = {
  id: 'post-1',
  author: { personId: 'p-ada', name: 'Ada Obi', photoUrl: null },
  body: 'Praise God for this week!',
  youtubeVideoId: null,
  createdAt: '2026-10-05T08:00:00.000Z',
  photos: [],
  reactionCounts: { LIKE: 2 },
  myReaction: null,
  commentCount: 0,
  canDelete: false,
};

function feed(viewer: { canPost: boolean; canModerate: boolean }, items: unknown[] = [POST]) {
  return { viewer: { ...viewer, personId: 'p-me' }, items, nextBefore: null };
}

describe('UpdatesFeed', () => {
  it('shows posts with author, text and reactions', async () => {
    mockFetch({ 'GET /api/updates': () => ({ body: feed({ canPost: true, canModerate: false }) }) });
    render(<UpdatesFeed />);
    const card = await screen.findByRole('article', { name: 'Post by Ada Obi' });
    expect(within(card).getByText('Praise God for this week!')).toBeInTheDocument();
    expect(within(card).getByText('👍 2')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('lets a member write a post', async () => {
    let posted: any = null;
    mockFetch({
      'GET /api/updates': () => ({ body: feed({ canPost: true, canModerate: false }, posted ? [POST] : []) }),
      'POST /api/updates': (_m, body) => {
        posted = body;
        return { status: 201, body: { id: 'new' } };
      },
    });
    render(<UpdatesFeed />);
    const box = await screen.findByLabelText('Write a post');
    fireEvent.change(box, { target: { value: 'Hello family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(posted).toEqual({ body: 'Hello family', photos: [] }));
    await screen.findByText('Praise God for this week!');
  });

  it('does not send an empty post', async () => {
    mockFetch({ 'GET /api/updates': () => ({ body: feed({ canPost: true, canModerate: false }, []) }) });
    render(<UpdatesFeed />);
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write something, or add a photo.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('hides the writing box for viewers who cannot post (admin)', async () => {
    mockFetch({ 'GET /api/updates': () => ({ body: feed({ canPost: false, canModerate: true }, [{ ...POST, canDelete: true }]) }) });
    render(<UpdatesFeed showComposer={false} />);
    await screen.findByText('Praise God for this week!');
    expect(screen.queryByLabelText('Write a post')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('removes a post after a moderator deletes it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch({
      'GET /api/updates': () => ({ body: feed({ canPost: false, canModerate: true }, [{ ...POST, canDelete: true }]) }),
      'DELETE /api/updates/post-1': () => ({ body: { ok: true } }),
    });
    render(<UpdatesFeed showComposer={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Praise God for this week!')).not.toBeInTheDocument());
  });

  it('reacts with the chosen emoji', async () => {
    mockFetch({
      'GET /api/updates': () => ({ body: feed({ canPost: true, canModerate: false }) }),
      'PUT /api/updates/post-1/reaction': (_m, body) => ({ body: { myReaction: body.type } }),
    });
    render(<UpdatesFeed />);
    fireEvent.click(await screen.findByRole('button', { name: /React/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Praying' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ type: 'PRAY' }),
    );
    expect(screen.getByText('👍🙏 3')).toBeInTheDocument();
  });
});

describe('Live', () => {
  it('shows the live banner when the admin is live', async () => {
    mockFetch({ 'GET /api/updates/live': () => ({ body: { live: { youtubeVideoId: 'dQw4w9WgXcQ', title: 'Sunday prayer', startedAt: '2026-10-05T08:00:00Z' } } }) });
    render(<LiveBanner />);
    expect(await screen.findByText('Sunday prayer')).toBeInTheDocument();
    expect(screen.getByTitle('Sunday prayer')).toHaveAttribute('src', expect.stringContaining('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  });

  it('shows nothing when not live', async () => {
    mockFetch({ 'GET /api/updates/live': () => ({ body: { live: null } }) });
    const { container } = render(<LiveBanner />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('lets the admin start a live from a YouTube link', async () => {
    mockFetch({
      'GET /api/updates/live': () => ({ body: { live: null } }),
      'PUT /api/updates/live': (_m, body) => ({ body: { live: { youtubeVideoId: 'dQw4w9WgXcQ', title: body.title, startedAt: 'x' } } }),
    });
    render(<AdminLiveControl />);
    fireEvent.change(await screen.findByLabelText('YouTube live link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: 'Evening prayer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show live to everyone' }));
    expect(await screen.findByRole('button', { name: 'End live' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', title: 'Evening prayer' });
  });
});
