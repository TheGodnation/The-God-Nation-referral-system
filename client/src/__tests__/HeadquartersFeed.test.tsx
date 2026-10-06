import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

const calls: { url: string; method: string }[] = [];

function mockFetch(routes: Record<string, () => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
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

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const HQ = {
  id: 'hq1',
  titleEn: 'Fasting week',
  titleFr: null,
  bodyEn: 'Beloved, from Monday we will fast and pray together as one family.',
  bodyFr: null,
  publishedAt: '2026-10-05T08:00:00.000Z',
  networkWide: true,
  commentCount: 2,
  reactionCount: 4,
  viewerHasReacted: false,
  media: { mediaType: 'IMAGE', originalFilename: 'flyer.jpg', byteSize: 1000 },
};

describe('Headquarters posts in the Updates feed', () => {
  it('shows the title, the start of the message and the photo, like a real post', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [HQ] } }),
      'GET /api/me/headquarters-posts/hq1/media/download-url': () => ({ body: { url: 'https://files.example/flyer.jpg' } }),
    });
    render(<HeadquartersPosts variant="feed" />);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    expect(within(card).getByText("God's Nation Headquarters")).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Fasting week' })).toBeInTheDocument();
    expect(within(card).getByText(/from Monday we will fast/)).toBeInTheDocument();
    expect(await within(card).findByAltText('Image attached to this post')).toHaveAttribute('src', 'https://files.example/flyer.jpg');
    expect(within(card).getByText('👍 4')).toBeInTheDocument();
    expect(within(card).getByText('2 comments')).toBeInTheDocument();
  });

  it('Like works straight from the card', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: null }] } }),
      'POST /api/me/headquarters-posts/hq1/reaction': () => ({ body: { viewerHasReacted: true, reactionCount: 5 } }),
    });
    render(<HeadquartersPosts variant="feed" />);
    const like = await screen.findByRole('button', { name: /Like/ });
    fireEvent.click(like);
    expect(await screen.findByText('👍 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Like/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Read more opens the full post with its comments', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: null }] } }),
      'GET /api/me/headquarters-posts/hq1/comments': () => ({ body: { items: [{ id: 'c1', authorName: 'Ada', isOwn: false, body: 'Amen', createdAt: HQ.publishedAt }], hasMore: false } }),
      'GET /api/me/headquarters-posts/hq1': () => ({ body: { ...HQ, media: null } }),
    });
    render(<HeadquartersPosts variant="feed" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read More' }));
    expect(await screen.findByText('Amen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('the dashboard list keeps its compact look', async () => {
    mockFetch({ 'GET /api/me/headquarters-posts': () => ({ body: { items: [HQ] } }) });
    render(<HeadquartersPosts />);
    expect(await screen.findByText('Headquarters Network Posts')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('Writing a post', () => {
  it('has photos but no YouTube option', async () => {
    mockFetch({
      'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items: [], nextBefore: null } }),
    });
    render(<UpdatesFeed wall />);
    await screen.findByLabelText('Write a post');
    expect(screen.getByRole('button', { name: /Photos/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /YouTube/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('YouTube link')).not.toBeInTheDocument();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  });
});
