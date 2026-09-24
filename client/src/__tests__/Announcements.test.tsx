import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Announcements } from '../components/Announcements';
import i18n from '../i18n';

// Phase 3M.3 — shared Member/Leader recipient view. Same
// URL-dispatching fetch mock pattern established across prior phases.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
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
  i18n.changeLanguage('en');
});

describe('Announcements (shared Member/Leader recipient view)', () => {
  it('renders nothing when there are no eligible announcements', async () => {
    mockFetchByUrl({
      '/api/me/announcements': { status: 200, body: { items: [] } },
    });

    const { container } = render(<Announcements />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('lists an eligible announcement by its English title', async () => {
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
            },
          ],
        },
      },
    });

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getByText('Community Retreat')).toBeInTheDocument();
    });
    expect(screen.getByText('Read More')).toBeInTheDocument();
  });

  it('opens the detail view and shows the full body', async () => {
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
            },
          ],
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

  it('returns to the list when Back is clicked', async () => {
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
            },
          ],
        },
      },
    });

    render(<Announcements />);

    fireEvent.click(await screen.findByText('Read More'));
    await waitFor(() => {
      expect(screen.getByText('Join us this weekend.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Back'));

    await waitFor(() => {
      expect(screen.getByText('Read More')).toBeInTheDocument();
    });
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
            },
          ],
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
            },
          ],
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
