import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Announcements } from '../components/Announcements';
import i18n from '../i18n';

// Phase 3M.3 — shared Member/Leader recipient view. Same
// URL-dispatching fetch mock pattern established across prior phases.
// Phase 3M.5 adds read/unread state: opening an announcement now fetches
// its detail via a real GET, then fires a POST .../read follow-up.
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

describe('Announcements (shared Member/Leader recipient view)', () => {
  it('renders nothing when there are no eligible announcements', async () => {
    mockFetchByUrl({
      '/api/me/announcements': { status: 200, body: { items: [], unreadCount: 0 } },
    });

    const { container } = render(<Announcements />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('lists an eligible announcement by its English title, with an unread badge and a header unread count', async () => {
    mockFetchByUrl({
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: false,
            },
          ],
          unreadCount: 1,
        },
      },
    });

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getByText('Community Retreat')).toBeInTheDocument();
    });
    expect(screen.getByText('Read More')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('a read announcement shows no unread badge', async () => {
    mockFetchByUrl({
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Already Read',
              titleFr: null,
              bodyEn: 'Body.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: true,
            },
          ],
          unreadCount: 0,
        },
      },
    });

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getByText('Already Read')).toBeInTheDocument();
    });
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
  });

  it('opens the detail view (a genuine GET), shows the full body, and marks it read', async () => {
    mockFetchByUrl({
      '/api/me/announcements/a1/read': { status: 200, body: { id: 'a1', isRead: true } },
      '/api/me/announcements/a1': {
        status: 200,
        body: {
          id: 'a1',
          titleEn: 'Community Retreat',
          titleFr: null,
          bodyEn: 'Join us this weekend.',
          bodyFr: null,
          publishedAt: '2026-01-01T00:00:00Z',
          isRead: false,
        },
      },
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: false,
            },
          ],
          unreadCount: 1,
        },
      },
    });

    render(<Announcements />);

    fireEvent.click(await screen.findByText('Read More'));

    await waitFor(() => {
      expect(screen.getByText('Join us this weekend.')).toBeInTheDocument();
    });
    expect(screen.getByText('Back')).toBeInTheDocument();

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/me/announcements/a1/read'))).toBe(true);
    });
  });

  it('does not call the read mutation for an announcement that is already read', async () => {
    mockFetchByUrl({
      '/api/me/announcements/a1': {
        status: 200,
        body: {
          id: 'a1',
          titleEn: 'Community Retreat',
          titleFr: null,
          bodyEn: 'Join us this weekend.',
          bodyFr: null,
          publishedAt: '2026-01-01T00:00:00Z',
          isRead: true,
        },
      },
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: true,
            },
          ],
          unreadCount: 0,
        },
      },
    });

    render(<Announcements />);

    fireEvent.click(await screen.findByText('Read More'));

    await waitFor(() => {
      expect(screen.getByText('Join us this weekend.')).toBeInTheDocument();
    });
    expect(calls.some((c) => c.url.includes('/read'))).toBe(false);
  });

  it('returning to the list after reading shows the item as no longer unread and lowers the header count', async () => {
    mockFetchByUrl({
      '/api/me/announcements/a1/read': { status: 200, body: { id: 'a1', isRead: true } },
      '/api/me/announcements/a1': {
        status: 200,
        body: {
          id: 'a1',
          titleEn: 'Community Retreat',
          titleFr: null,
          bodyEn: 'Join us this weekend.',
          bodyFr: null,
          publishedAt: '2026-01-01T00:00:00Z',
          isRead: false,
        },
      },
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: false,
            },
          ],
          unreadCount: 1,
        },
      },
    });

    render(<Announcements />);

    fireEvent.click(await screen.findByText('Read More'));
    await waitFor(() => {
      expect(screen.getByText('Join us this weekend.')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/read'))).toBe(true);
    });

    fireEvent.click(screen.getByText('Back'));

    await waitFor(() => {
      expect(screen.getByText('Read More')).toBeInTheDocument();
    });
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('still displays the announcement content even if the read-mark mutation fails', async () => {
    mockFetchByUrl({
      '/api/me/announcements/a1/read': { status: 500, body: { error: 'boom' } },
      '/api/me/announcements/a1': {
        status: 200,
        body: {
          id: 'a1',
          titleEn: 'Community Retreat',
          titleFr: null,
          bodyEn: 'Join us this weekend.',
          bodyFr: null,
          publishedAt: '2026-01-01T00:00:00Z',
          isRead: false,
        },
      },
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: false,
            },
          ],
          unreadCount: 1,
        },
      },
    });

    render(<Announcements />);

    fireEvent.click(await screen.findByText('Read More'));

    await waitFor(() => {
      expect(screen.getByText('Join us this weekend.')).toBeInTheDocument();
    });
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('shows an error when opening the detail view fails', async () => {
    mockFetchByUrl({
      '/api/me/announcements/a1': { status: 500, body: { error: 'boom' } },
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: false,
            },
          ],
          unreadCount: 1,
        },
      },
    });

    render(<Announcements />);

    fireEvent.click(await screen.findByText('Read More'));

    await waitFor(() => {
      expect(screen.getByText('Failed to load announcements.')).toBeInTheDocument();
    });
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('shows the French title/body when the UI language is French and French content exists', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: 'Retraite Communautaire',
              bodyEn: 'Join us this weekend.',
              bodyFr: 'Rejoignez-nous ce week-end.',
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: true,
            },
          ],
          unreadCount: 0,
        },
      },
    });

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getByText('Retraite Communautaire')).toBeInTheDocument();
    });
  });

  it('falls back to English content when the UI language is French but no French content exists', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/me/announcements': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              titleEn: 'Community Retreat',
              titleFr: null,
              bodyEn: 'Join us this weekend.',
              bodyFr: null,
              publishedAt: '2026-01-01T00:00:00Z',
              isRead: true,
            },
          ],
          unreadCount: 0,
        },
      },
    });

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getByText('Community Retreat')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({
      '/api/me/announcements': { status: 500, body: { error: 'boom' } },
    });

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load announcements.')).toBeInTheDocument();
    });
  });
});
