import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import i18n from '../i18n';

// Headquarters Network Posts & Shared Engagement — shared Member/Leader
// recipient view. Same URL-dispatching fetch mock pattern established by
// Announcements.test.tsx.
const calls: { url: string; method: string }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  i18n.changeLanguage('en');
});

const POST_A = {
  id: 'p1',
  titleEn: 'Network Update',
  titleFr: null,
  bodyEn: 'A message from headquarters.',
  bodyFr: null,
  publishedAt: '2026-01-01T00:00:00Z',
  networkWide: true,
  commentCount: 0,
  reactionCount: 0,
  viewerHasReacted: false,
};

describe('HeadquartersPosts (shared Member/Leader recipient view)', () => {
  it('renders nothing when there are no eligible posts', async () => {
    mockFetchByUrl({ '/api/me/headquarters-posts': { status: 200, body: { items: [] } } });

    const { container } = render(<HeadquartersPosts />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('lists an eligible post with a network-wide source label', async () => {
    mockFetchByUrl({ '/api/me/headquarters-posts': { status: 200, body: { items: [POST_A] } } });

    render(<HeadquartersPosts />);

    await waitFor(() => {
      expect(screen.getByText('Network Update')).toBeInTheDocument();
    });
    expect(screen.getByText('From National Headquarters — Network Wide')).toBeInTheDocument();
  });

  it('shows a targeted (non-network-wide) source label for a targeted post', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts': { status: 200, body: { items: [{ ...POST_A, id: 'p2', networkWide: false }] } },
    });

    render(<HeadquartersPosts />);

    await waitFor(() => {
      expect(screen.getByText('From National Headquarters')).toBeInTheDocument();
    });
  });

  it('opens the detail view, loads comments, and shows the reaction count', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1': { status: 200, body: POST_A },
      '/api/me/headquarters-posts': { status: 200, body: { items: [POST_A] } },
    });

    render(<HeadquartersPosts />);

    fireEvent.click(await screen.findByText('Read More'));

    await waitFor(() => {
      expect(screen.getByText('A message from headquarters.')).toBeInTheDocument();
    });
    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    expect(screen.getByText('0 reactions')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('posts a new comment and appends it to the shared thread', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1': { status: 200, body: POST_A },
      '/api/me/headquarters-posts': { status: 200, body: { items: [POST_A] } },
    });

    render(<HeadquartersPosts />);
    fireEvent.click(await screen.findByText('Read More'));
    await waitFor(() => expect(screen.getByText('No comments yet.')).toBeInTheDocument());

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        if (url.includes('/comments') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'c1', authorName: 'Jane', isOwn: true, body: 'Amen!', createdAt: '2026-01-02T00:00:00Z' }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
      }),
    );

    const textarea = screen.getByPlaceholderText('Write a comment…');
    fireEvent.change(textarea, { target: { value: 'Amen!' } });
    fireEvent.click(screen.getByText('Post Comment'));

    await waitFor(() => {
      expect(screen.getByText('Amen!')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('reacting to a post updates the button label and count', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1': { status: 200, body: POST_A },
      '/api/me/headquarters-posts': { status: 200, body: { items: [POST_A] } },
    });

    render(<HeadquartersPosts />);
    fireEvent.click(await screen.findByText('Read More'));
    await waitFor(() => expect(screen.getByText('React')).toBeInTheDocument());

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        if (url.includes('/reaction') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'p1', viewerHasReacted: true, reactionCount: 1 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
      }),
    );

    fireEvent.click(screen.getByText('React'));

    await waitFor(() => {
      expect(screen.getByText('Reacted')).toBeInTheDocument();
    });
    expect(screen.getByText('1 reactions')).toBeInTheDocument();
  });

  it('shows the French title when the UI language is French and French content exists', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/me/headquarters-posts': {
        status: 200,
        body: { items: [{ ...POST_A, titleFr: 'Mise à jour du réseau' }] },
      },
    });

    render(<HeadquartersPosts />);

    await waitFor(() => {
      expect(screen.getByText('Mise à jour du réseau')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({ '/api/me/headquarters-posts': { status: 500, body: { error: 'boom' } } });

    render(<HeadquartersPosts />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load headquarters posts.')).toBeInTheDocument();
    });
  });
});
