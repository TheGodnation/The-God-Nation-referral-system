import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';

// Long posts are never cut: a 5,000-character post goes out whole (the old
// 3,000 cap cut it silently); past 63,206 the box says so instead.
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
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('Long posts', () => {
  it('sends a 5,000-character post whole, and warns past the limit instead of cutting', async () => {
    mockFetch({
      'GET /api/updates': () => ({ body: { viewer: { canPost: true, canModerate: false, personId: 'me' }, items: [], nextBefore: null } }),
      'POST /api/updates': () => ({ status: 201, body: { id: 'new' } }),
    });
    render(<UpdatesFeed />);
    const box = await screen.findByLabelText('Write a post');
    fireEvent.change(box, { target: { value: 'x'.repeat(63206 + 5) } });
    expect(screen.getByRole('alert')).toHaveTextContent('5 characters too long');
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();

    const long = 'Teaching: '.repeat(500);
    fireEvent.change(box, { target: { value: long } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body.body).toHaveLength(long.trim().length));
  });
});
