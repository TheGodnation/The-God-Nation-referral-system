import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n';
import { MyLeadershipPeers } from '../components/leader/MyLeadershipPeers';

// Phase 2A — same URL-dispatching fetch mock pattern as
// MyLeadershipProposals.test.tsx / MyMembers.test.tsx.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const match = Object.keys(responses).find((key) => url.includes(key));
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

describe('MyLeadershipPeers', () => {
  it('renders nothing while loading', async () => {
    mockFetchByUrl({
      '/api/leader/peers': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } },
    });

    const { container } = render(<MyLeadershipPeers />);
    expect(container).toBeEmptyDOMElement();

    await waitFor(() => {
      expect(container).not.toBeEmptyDOMElement();
    });
  });

  it('shows a visible empty state when the Leader has no peers', async () => {
    mockFetchByUrl({
      '/api/leader/peers': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } },
    });

    render(<MyLeadershipPeers />);

    await waitFor(() => {
      expect(screen.getByText('No leadership peers found at your generation yet.')).toBeInTheDocument();
    });
    expect(screen.getByText('My Leadership Peers')).toBeInTheDocument();
  });

  it('renders peer name, community, and generation', async () => {
    mockFetchByUrl({
      '/api/leader/peers': {
        status: 200,
        body: {
          items: [
            { personId: 'p1', name: 'Jane Doe', communityId: 'c1', communityName: 'North Community', generation: 2 },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyLeadershipPeers />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('North Community')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    mockFetchByUrl({
      '/api/leader/peers': { status: 500, body: { error: 'boom' } },
    });

    render(<MyLeadershipPeers />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load your leadership peers.')).toBeInTheDocument();
    });
  });

  it('never shows a message/contact action for a peer row', async () => {
    mockFetchByUrl({
      '/api/leader/peers': {
        status: 200,
        body: {
          items: [
            { personId: 'p1', name: 'Jane Doe', communityId: 'c1', communityName: 'North Community', generation: 2 },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyLeadershipPeers />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /message/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /propose/i })).not.toBeInTheDocument();
  });

  it('renders in French when the active language is French', async () => {
    mockFetchByUrl({
      '/api/leader/peers': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } },
    });

    await i18n.changeLanguage('fr');
    render(<MyLeadershipPeers />);

    await waitFor(() => {
      expect(screen.getByText('Mes pairs de leadership')).toBeInTheDocument();
    });
    expect(screen.getByText('Aucun pair de leadership trouvé à votre génération pour le moment.')).toBeInTheDocument();
  });
});
