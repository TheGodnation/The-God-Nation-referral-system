import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MyResources } from '../components/MyResources';
import i18n from '../i18n';

// Book / Resource Access Grants — shared Member/Leader recipient view. Same
// URL-dispatching fetch mock pattern established by PrivateMessages.test.tsx.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
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

const ONE_RESOURCE = {
  items: [
    {
      id: 'r1',
      titleEn: 'Foundations of Faith',
      titleFr: 'Fondements de la foi',
      descriptionEn: 'An introductory teaching.',
      descriptionFr: 'Un enseignement introductif.',
      url: 'https://example.com/book.pdf',
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

describe('MyResources (shared Member/Leader recipient view)', () => {
  it('renders nothing while loading', () => {
    mockFetchByUrl({ '/api/me/resources': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } } });
    const { container } = render(<MyResources />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no resources and alwaysShow is not set', async () => {
    mockFetchByUrl({ '/api/me/resources': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } } });

    const { container } = render(<MyResources />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('shows an empty state when alwaysShow is set and there are no resources', async () => {
    mockFetchByUrl({ '/api/me/resources': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } } });

    render(<MyResources alwaysShow />);

    await waitFor(() => {
      expect(screen.getByText('No resources available yet.')).toBeInTheDocument();
    });
  });

  it('lists a resource the caller has been granted access to, with its title, description, and link', async () => {
    mockFetchByUrl({ '/api/me/resources': { status: 200, body: ONE_RESOURCE } });

    render(<MyResources />);

    await waitFor(() => {
      expect(screen.getByText('Foundations of Faith')).toBeInTheDocument();
    });
    expect(screen.getByText('An introductory teaching.')).toBeInTheDocument();
    const link = screen.getByText('Open') as HTMLAnchorElement;
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/book.pdf');
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({ '/api/me/resources': { status: 500, body: { error: 'boom' } } });

    render(<MyResources alwaysShow />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load resources.')).toBeInTheDocument();
    });
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({ '/api/me/resources': { status: 200, body: ONE_RESOURCE } });

    render(<MyResources />);

    await waitFor(() => {
      expect(screen.getByText('Fondements de la foi')).toBeInTheDocument();
    });
    expect(screen.getByText('Un enseignement introductif.')).toBeInTheDocument();
    expect(screen.getByText('Ressources')).toBeInTheDocument();
  });
});
