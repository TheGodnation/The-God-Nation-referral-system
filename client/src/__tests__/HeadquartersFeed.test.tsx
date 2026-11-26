import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

let isCentralAdmin = false;
vi.mock('../lib/MemberAuthContext', () => ({
  useMemberAuth: () => ({ member: { personId: 'p-me', name: 'Me', isCentralAdmin } }),
}));

const calls: { url: string; method: string; body?: unknown }[] = [];

function mockFetch(routes: Record<string, () => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
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
  isCentralAdmin = false;
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
  media: [{ id: 'm1', mediaType: 'IMAGE', originalFilename: 'flyer.jpg', byteSize: 1000 }],
};

const COMMENT = {
  id: 'c1',
  parentCommentId: null,
  author: { personId: 'p-ada', name: 'Ada', photoUrl: null },
  authorName: 'Ada',
  isOwn: false,
  body: 'Amen',
  createdAt: '2026-10-05T08:00:00.000Z',
  reactionCounts: {},
  myReaction: null,
  canDelete: false,
};

describe('Headquarters posts in the Updates feed', () => {
  it('shows the title, the start of the message and the photo, like a real post', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [HQ] } }),
      'GET /api/me/headquarters-posts/hq1/media/m1/download-url': () => ({ body: { url: 'https://files.example/flyer.jpg' } }),
    });
    render(<HeadquartersPosts variant="feed" />);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    expect(within(card).getByText('The God Nation Headquarters')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Fasting week' })).toBeInTheDocument();
    expect(within(card).getByText(/from Monday we will fast/)).toBeInTheDocument();
    expect(await within(card).findByAltText('Image attached to this post')).toHaveAttribute('src', 'https://files.example/flyer.jpg');
    expect(within(card).getByText('👍 4')).toBeInTheDocument();
    expect(within(card).getByText('2 comments')).toBeInTheDocument();
  });

  it('offers the same six reactions as every other post, and sends the one picked', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [] }] } }),
      'POST /api/me/headquarters-posts/hq1/reaction': () => ({
        body: { viewerHasReacted: true, reactionCount: 5, reactionCounts: { LIKE: 3, PRAY: 2 }, myReaction: 'PRAY' },
      }),
    });
    render(<HeadquartersPosts variant="feed" />);
    fireEvent.click(await screen.findByRole('button', { name: /Like/ }));
    const menu = within(screen.getByRole('menu'));
    expect(menu.getAllByRole('menuitem')).toHaveLength(6);
    fireEvent.click(menu.getByRole('menuitem', { name: 'Praying' }));
    expect(await screen.findByText('👍🙏 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Praying/ })).toHaveAttribute('aria-pressed', 'true');
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/reaction'));
    expect(post).toBeTruthy();
  });

  it('Read more expands the full post with its comments right there in the card, Facebook-style — no "Back" page', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [] }] } }),
      'GET /api/me/headquarters-posts/hq1/comments': () => ({ body: { items: [COMMENT], hasMore: false } }),
      'GET /api/me/headquarters-posts/hq1': () => ({ body: { ...HQ, media: [] } }),
    });
    render(<HeadquartersPosts variant="feed" />);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    fireEvent.click(within(card).getByRole('button', { name: 'Read More' }));
    expect(await within(card).findByText('Amen')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/comments?thread=1'))).toBe(true);
    // Still the same card — its title and Like/Comment buttons are right there, no separate "Back" page.
    expect(within(card).getByRole('heading', { name: 'Fasting week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Read less' })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Read less' }));
    expect(screen.queryByText('Amen')).not.toBeInTheDocument();
  });

  it('a comment under a Headquarters post can be liked and replied to', async () => {
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [] }] } }),
      'GET /api/me/headquarters-posts/hq1/comments': () => ({ body: { items: [COMMENT], hasMore: false } }),
      'GET /api/me/headquarters-posts/hq1': () => ({ body: { ...HQ, media: [] } }),
      'PUT /api/me/headquarters-posts/comments/c1/reaction': () => ({ body: { reactionCounts: { LIKE: 1 }, myReaction: 'LIKE' } }),
      'POST /api/me/headquarters-posts/hq1/comments': () => ({ status: 201, body: { ...COMMENT, id: 'c2', parentCommentId: 'c1', body: 'Amen too' } }),
    });
    render(<HeadquartersPosts variant="feed" />);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    fireEvent.click(within(card).getByRole('button', { name: 'Read More' }));
    const comment = await within(card).findByRole('group', { name: 'Comment by Ada' });

    fireEvent.click(within(comment).getByRole('button', { name: 'Like' }));
    fireEvent.click(within(comment).getByRole('menuitem', { name: 'Like' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/comments/c1/reaction'))).toBe(true));
    expect(await within(comment).findByText('👍 1')).toBeInTheDocument();

    fireEvent.click(within(comment).getByRole('button', { name: 'Reply' }));
    const box = within(card).getByLabelText('Reply to Ada');
    fireEvent.change(box, { target: { value: 'Amen too' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/hq1/comments'))).toBe(true));
    const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/hq1/comments'))!;
    expect(sent.body).toEqual({ body: 'Amen too', parentCommentId: 'c1' });
  });

  it('the central admin corrects a post from its ⋯ menu; members see no menu', async () => {
    isCentralAdmin = true;
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [] }] } }),
      'PATCH /api/member/central-headquarters-posts/hq1': () => ({
        body: { titleEn: 'Fasting week (corrected)', titleFr: HQ.titleFr, bodyEn: HQ.bodyEn, bodyFr: HQ.bodyFr, editedAt: '2026-11-16T10:00:00.000Z' },
      }),
    });
    render(<MemoryRouter><HeadquartersPosts variant="feed" /></MemoryRouter>);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    fireEvent.click(within(card).getByRole('button', { name: 'More options' }));
    fireEvent.click(within(card).getByRole('menuitem', { name: /Edit/ }));
    const title = within(card).getByLabelText('Title (English)');
    fireEvent.change(title, { target: { value: 'Fasting week (corrected)' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Fasting week (corrected)' })).toBeInTheDocument();
    expect(screen.getByText(/· edited/)).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ titleEn: 'Fasting week (corrected)' });
  });

  it('a member sees no ⋯ edit menu on a Headquarters post', async () => {
    mockFetch({ 'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [] }] } }) });
    render(<MemoryRouter><HeadquartersPosts variant="feed" /></MemoryRouter>);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    expect(within(card).queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
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


describe('Who a Headquarters post shows as', () => {
  const show = async (extra: Record<string, unknown>) => {
    mockFetch({ 'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [], ...extra }] } }) });
    render(
      <MemoryRouter>
        <HeadquartersPosts variant="feed" />
      </MemoryRouter>,
    );
    await screen.findByText('Fasting week');
  };

  it('posted as the person: their own name, photo and title, not the Headquarters name', async () => {
    await show({ author: { personId: 'p1', name: 'Evangelist Stanley A. Ndoh', photoUrl: null, title: 'Founder' } });
    const who = screen.getByTestId('hq-post-author');
    expect(who).toHaveTextContent('Evangelist Stanley A. Ndoh');
    expect(who).toHaveTextContent('Founder');
    expect(within(who).getByRole('link')).toHaveAttribute('href', '/member/people/p1');
    expect(screen.queryByText('The God Nation Headquarters')).toBeNull();
  });

  it('posted as the Communication Department or as Headquarters: that official name', async () => {
    await show({ author: null, voice: 'COMMUNICATION_DEPARTMENT' });
    expect(screen.getByText("God's Nation Communication Department")).toBeInTheDocument();
    expect(screen.queryByTestId('hq-post-author')).toBeNull();
  });

  it('with nothing set it is the Headquarters', async () => {
    await show({ author: null });
    expect(screen.getByText('The God Nation Headquarters')).toBeInTheDocument();
  });
});

describe('Sharing a post by link from the ⋯ menu', () => {
  const POST = (badge: string | null, over: Record<string, unknown> = {}) => ({
    id: 'u1', author: { personId: 'p-me', name: 'Evangelist', photoUrl: null, badge }, body: 'Come and see what God is doing', audience: 'EVERYONE', youtubeVideoId: null,
    createdAt: '2026-11-20T08:00:00.000Z', photos: [], reactionCounts: {}, myReaction: null, commentCount: 0, canDelete: true, canEdit: true, ...over,
  });
  const feed = (post: unknown) =>
    mockFetch({ 'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'p-me' }, items: [post], nextBefore: null } }) });

  it('the National Coordinator’s own post offers Share by link next to Edit', async () => {
    feed(POST('NATIONAL_COORDINATOR'));
    render(<MemoryRouter><UpdatesFeed wall /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Share by link/ })).toBeInTheDocument();
  });

  it('an ordinary member’s own post, and a friends-only post, keep Edit alone', async () => {
    feed(POST(null));
    const first = render(<MemoryRouter><UpdatesFeed wall /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: /Share by link/ })).not.toBeInTheDocument();
    first.unmount();
    feed(POST('NATIONAL_COORDINATOR', { audience: 'FRIENDS' }));
    render(<MemoryRouter><UpdatesFeed wall /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: /Share by link/ })).not.toBeInTheDocument();
  });

  it('an official Headquarters post offers Share by link to the central admin', async () => {
    isCentralAdmin = true;
    mockFetch({ 'GET /api/me/headquarters-posts': () => ({ body: { items: [{ ...HQ, media: [] }] } }) });
    render(<MemoryRouter><HeadquartersPosts variant="feed" /></MemoryRouter>);
    const card = await screen.findByRole('article', { name: 'Headquarters post: Fasting week' });
    fireEvent.click(within(card).getByRole('button', { name: 'More options' }));
    expect(within(card).getByRole('menuitem', { name: /Share by link/ })).toBeInTheDocument();
  });
});

describe('A shared post link opened by a member', () => {
  it('puts that post first and open, even when it is older than the first page of posts', async () => {
    const OLD = { ...HQ, id: 'hq-old', titleEn: 'An older teaching', media: [] };
    const NEWER = { ...HQ, id: 'hq-new', titleEn: 'Newest news', media: [] };
    mockFetch({
      'GET /api/me/headquarters-posts': () => ({ body: { items: [NEWER] } }),
      'GET /api/me/headquarters-posts/hq-old': () => ({ body: OLD }),
      'GET /api/me/headquarters-posts/hq-old/comments': () => ({ body: { items: [], hasMore: false } }),
    });
    render(
      <MemoryRouter>
        <HeadquartersPosts variant="feed" openId="hq-old" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll('[id^="hq-post-"]')).toHaveLength(2));
    const cards = Array.from(document.querySelectorAll('[id^="hq-post-"]'));
    expect(cards[0].id).toBe('hq-post-hq-old');
    expect(cards[0]).toHaveTextContent('An older teaching');
    // It is opened (the full post is asked for).
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me/headquarters-posts/hq-old')).toBe(true));
  });
});
