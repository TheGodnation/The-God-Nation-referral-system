import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HeadquartersPostsTab } from '../components/admin/HeadquartersPostsTab';

// Headquarters Network Posts & Shared Engagement — Admin management tab.
// Same URL-dispatching fetch mock pattern established by
// AnnouncementsTab.test.tsx.
const calls: { url: string; method: string; body: unknown }[] = [];

const DRAFT_ROW = {
  id: 'hqp-1',
  titleEn: 'Draft Post',
  titleFr: null,
  bodyEn: 'Draft body.',
  bodyFr: null,
  networkWide: false,
  createdAt: '2026-01-01T00:00:00Z',
  publishedAt: null,
  archivedAt: null,
  createdBy: { id: 'admin-1', email: 'admin@test.local' },
  targets: [{ id: 't1', communityId: 'community-1', communityName: 'Youth Ministry' }],
  commentCount: 0,
  reactionCount: 0,
};

const NETWORK_WIDE_PUBLISHED_ROW = {
  ...DRAFT_ROW,
  id: 'hqp-2',
  titleEn: 'Network Wide Post',
  networkWide: true,
  targets: [],
  publishedAt: '2026-01-05T00:00:00Z',
  commentCount: 3,
  reactionCount: 7,
};

const ARCHIVED_ROW = {
  ...DRAFT_ROW,
  id: 'hqp-3',
  titleEn: 'Archived Post',
  publishedAt: '2026-01-02T00:00:00Z',
  archivedAt: '2026-01-06T00:00:00Z',
};

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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
});

describe('HeadquartersPostsTab (Admin)', () => {
  it('lists posts with title, status, audience, and engagement summary', async () => {
    mockFetchByUrl({
      '/api/admin/headquarters-posts': { status: 200, body: { items: [NETWORK_WIDE_PUBLISHED_ROW], pagination: { totalPages: 1 } } },
    });

    render(<HeadquartersPostsTab />);

    await waitFor(() => {
      expect(screen.getByText('Network Wide Post')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
    expect(screen.getByText('Network-Wide (entire Headquarters Community network)')).toBeInTheDocument();
    expect(screen.getByText('3 comments, 7 reactions')).toBeInTheDocument();
  });

  it('shows Edit and Publish for a draft, but only Archive for a published row, and neither for an archived row', async () => {
    mockFetchByUrl({
      '/api/admin/headquarters-posts': {
        status: 200,
        body: { items: [DRAFT_ROW, NETWORK_WIDE_PUBLISHED_ROW, ARCHIVED_ROW], pagination: { totalPages: 1 } },
      },
    });

    render(<HeadquartersPostsTab />);

    await waitFor(() => {
      expect(screen.getByText('Draft Post')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Edit')).toHaveLength(1);
    expect(screen.getAllByText('Publish')).toHaveLength(1);
    expect(screen.getAllByText('Archive')).toHaveLength(2);
  });

  it('creates a draft with a selected Community target and reloads the list', async () => {
    mockFetchByUrl({
      '/api/admin/headquarters-posts': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'community-1', name: 'Youth Ministry' }] } },
    });

    render(<HeadquartersPostsTab />);

    fireEvent.click(await screen.findByText('+ New Post'));

    fireEvent.change(screen.getByLabelText('Title (English)'), { target: { value: 'New Post' } });
    fireEvent.change(screen.getByLabelText('Body (English)'), { target: { value: 'New body.' } });

    fireEvent.click(screen.getByLabelText('Selected Communities'));
    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'Youth' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'community-1' } });
    fireEvent.click(screen.getByText('Add Community'));

    expect(screen.getAllByText(/Youth Ministry/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Create Draft'));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/headquarters-posts');
      expect(createCall).toBeTruthy();
      expect((createCall!.body as any).titleEn).toBe('New Post');
    });

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect((patchCall!.body as any).targetCommunityIds).toEqual(['community-1']);
    });
  });

  it('choosing network-wide audience sends networkWide: true and no target picker is shown', async () => {
    mockFetchByUrl({
      '/api/admin/headquarters-posts': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<HeadquartersPostsTab />);

    fireEvent.click(await screen.findByText('+ New Post'));
    fireEvent.change(screen.getByLabelText('Title (English)'), { target: { value: 'Network Post' } });
    fireEvent.change(screen.getByLabelText('Body (English)'), { target: { value: 'Body.' } });

    fireEvent.click(screen.getByLabelText('Network-Wide (entire Headquarters Community network)'));
    expect(screen.queryByPlaceholderText('Search communities by name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Create Draft'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect((patchCall!.body as any).networkWide).toBe(true);
    });
  });

  it('publishes a draft', async () => {
    mockFetchByUrl({
      '/api/admin/headquarters-posts/hqp-1/publish': { status: 200, body: { ...DRAFT_ROW, publishedAt: '2026-02-01T00:00:00Z' } },
      '/api/admin/headquarters-posts': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });

    render(<HeadquartersPostsTab />);

    fireEvent.click(await screen.findByText('Publish'));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/publish'))).toBe(true);
    });
  });

  it('archives a post after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetchByUrl({
      '/api/admin/headquarters-posts/hqp-1/archive': { status: 200, body: { ...DRAFT_ROW, archivedAt: '2026-02-01T00:00:00Z' } },
      '/api/admin/headquarters-posts': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });

    render(<HeadquartersPostsTab />);

    fireEvent.click(await screen.findByText('Archive'));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/archive'))).toBe(true);
    });
  });

  it('shows an error when the list fails to load', async () => {
    mockFetchByUrl({ '/api/admin/headquarters-posts': { status: 500, body: { error: 'boom' } } });

    render(<HeadquartersPostsTab />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load headquarters posts.')).toBeInTheDocument();
    });
  });

  it('shows an empty state when there are no posts', async () => {
    mockFetchByUrl({ '/api/admin/headquarters-posts': { status: 200, body: { items: [], pagination: { totalPages: 1 } } } });

    render(<HeadquartersPostsTab />);

    await waitFor(() => {
      expect(screen.getByText('No headquarters posts found.')).toBeInTheDocument();
    });
  });
});
