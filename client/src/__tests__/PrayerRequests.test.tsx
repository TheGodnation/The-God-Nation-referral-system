import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrayerRequests } from '../components/PrayerRequests';

// Phase 2 — Prayer requests. Same URL-dispatching fetch mock pattern
// established by HeadquartersPostsTabMedia.test.tsx.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const bodyIsString = typeof init?.body === 'string';
      calls.push({ url, method: init?.method ?? 'GET', body: bodyIsString ? JSON.parse(init!.body as string) : init?.body });
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

const AUTHOR = { personId: 'p1', name: 'Grace Mbeki', photoUrl: null };

const REQUEST_A = {
  id: 'req-1',
  author: AUTHOR,
  body: 'Please pray for my family.',
  visibility: 'PUBLIC' as const,
  community: null,
  createdAt: '2026-01-01T00:00:00Z',
  commentCount: 0,
  canDelete: false,
};

describe('PrayerRequests — feed', () => {
  it('shows an empty state when there are no public requests', async () => {
    mockFetchByUrl({ '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [], nextBefore: null } } });
    render(<PrayerRequests />);
    expect(await screen.findByText('No prayer requests yet.')).toBeInTheDocument();
  });

  it('lists a public request with the author and comment count', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [REQUEST_A], nextBefore: null } },
    });
    render(<PrayerRequests />);
    expect(await screen.findByText('Grace Mbeki')).toBeInTheDocument();
    expect(screen.getByText('Please pray for my family.')).toBeInTheDocument();
    expect(screen.getByText(/0 comments/)).toBeInTheDocument();
  });

  it('shows the Community name and a lock marker for a private request', async () => {
    const privateRequest = { ...REQUEST_A, id: 'req-2', visibility: 'PRIVATE' as const, community: { id: 'c1', name: 'Buea Group' } };
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [privateRequest], nextBefore: null } },
    });
    render(<PrayerRequests />);
    expect(await screen.findByText(/shared privately with Buea Group/)).toBeInTheDocument();
  });

  it('switching to the Private tab re-fetches with scope=private', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [REQUEST_A], nextBefore: null } },
      '/api/prayer-requests?scope=private': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [], nextBefore: null } },
    });
    render(<PrayerRequests />);
    await screen.findByText('Grace Mbeki');
    fireEvent.click(screen.getByRole('tab', { name: 'Private' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('scope=private'))).toBe(true));
    expect(await screen.findByText('No prayer requests yet.')).toBeInTheDocument();
  });

  it('does not show the composer for a viewer with no Person identity (Admin)', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: false, personId: null }, items: [REQUEST_A], nextBefore: null } },
    });
    render(<PrayerRequests />);
    await screen.findByText('Grace Mbeki');
    expect(screen.queryByPlaceholderText(/Share something/)).not.toBeInTheDocument();
  });

  it('a request the viewer may delete shows a delete button that removes it from the list', async () => {
    const mine = { ...REQUEST_A, canDelete: true };
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [mine], nextBefore: null } },
      '/api/prayer-requests/req-1': { status: 200, body: { ok: true } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PrayerRequests />);
    await screen.findByText('Grace Mbeki');
    fireEvent.click(screen.getByLabelText('Delete'));
    await waitFor(() => expect(screen.queryByText('Grace Mbeki')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/prayer-requests/req-1'))).toBe(true);
  });
});

describe('PrayerRequests — composing', () => {
  it('posts a public request with the chosen visibility and clears the form', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [], nextBefore: null } },
      '/api/prayer-requests': { status: 201, body: { id: 'new-1' } },
    });
    render(<PrayerRequests />);
    await screen.findByText('No prayer requests yet.');

    const textarea = screen.getByLabelText('Share a prayer request');
    fireEvent.change(textarea, { target: { value: 'Pray for my exams.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/prayer-requests'));
      expect(createCall?.body).toEqual({ body: 'Pray for my exams.', visibility: 'PUBLIC' });
    });
    // A successful post reloads the feed, which unmounts and remounts the
    // Composer with fresh (empty) state — re-query rather than reuse the
    // detached `textarea` reference above.
    await waitFor(() => expect((screen.getByLabelText('Share a prayer request') as HTMLTextAreaElement).value).toBe(''));
  });

  it('posts a private request when the Private radio is chosen', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [], nextBefore: null } },
      '/api/prayer-requests': { status: 201, body: { id: 'new-2' } },
    });
    render(<PrayerRequests />);
    await screen.findByText('No prayer requests yet.');

    fireEvent.change(screen.getByLabelText('Share a prayer request'), { target: { value: 'Private matter.' } });
    fireEvent.click(screen.getByLabelText('Private'));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/prayer-requests'));
      expect(createCall?.body).toEqual({ body: 'Private matter.', visibility: 'PRIVATE' });
    });
  });

  it('shows a clear message when the author has no Community yet', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [], nextBefore: null } },
      '/api/prayer-requests': { status: 400, body: { error: 'none', code: 'NO_COMMUNITY' } },
    });
    render(<PrayerRequests />);
    await screen.findByText('No prayer requests yet.');

    fireEvent.change(screen.getByLabelText('Share a prayer request'), { target: { value: 'x' } });
    fireEvent.click(screen.getByLabelText('Private'));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText('You do not belong to an assembly yet. Please share this publicly, or ask an Admin.')).toBeInTheDocument();
  });
});

describe('PrayerRequests — comments', () => {
  it('opens the comment thread and posts a new comment', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: true, personId: 'me' }, items: [REQUEST_A], nextBefore: null } },
      '/api/prayer-requests/req-1/comments': { status: 200, body: { items: [{ id: 'c1', author: AUTHOR, body: 'Amen!', createdAt: '2026-01-01T00:00:00Z', canDelete: false }] } },
    });
    render(<PrayerRequests />);
    await screen.findByText('Grace Mbeki');
    fireEvent.click(screen.getByText(/0 comments/));

    expect(await screen.findByText('Amen!')).toBeInTheDocument();

    const input = screen.getByLabelText('Write a comment');
    fireEvent.change(input, { target: { value: 'Praying with you.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/prayer-requests/req-1/comments'));
      expect(postCall?.body).toEqual({ body: 'Praying with you.' });
    });
  });

  it('does not show a comment box for a viewer with no Person identity (Admin)', async () => {
    mockFetchByUrl({
      '/api/prayer-requests?scope=public': { status: 200, body: { viewer: { canPost: false, personId: null }, items: [REQUEST_A], nextBefore: null } },
      '/api/prayer-requests/req-1/comments': { status: 200, body: { items: [] } },
    });
    render(<PrayerRequests />);
    await screen.findByText('Grace Mbeki');
    fireEvent.click(screen.getByText(/0 comments/));
    await screen.findByText('No comments yet.');
    expect(screen.queryByLabelText('Write a comment')).not.toBeInTheDocument();
  });
});
