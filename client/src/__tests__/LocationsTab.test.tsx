import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LocationsTab } from '../components/admin/LocationsTab';
import i18n from '../i18n';

// Member Location & Central Authority Location Intelligence — same
// URL-dispatching fetch mock pattern established across prior admin-tab
// client tests (e.g. RoleAssignmentsTabLeadershipProposals.test.tsx).
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

const ONE_GROUP = {
  items: [
    {
      country: 'Cameroon',
      city: 'Douala',
      area: 'Bonamoussadi',
      memberCount: 84,
      assignedCount: 69,
      unassignedCount: 15,
      communities: [
        { communityId: 'c1', communityName: 'Community A1', count: 52 },
        { communityId: 'c2', communityName: 'Community A2', count: 17 },
      ],
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

describe('LocationsTab', () => {
  it('renders aggregated location rows with member/assigned/unassigned counts', async () => {
    mockFetchByUrl({ '/api/admin/locations': { status: 200, body: ONE_GROUP } });

    render(<LocationsTab includeTestData={false} />);

    await waitFor(() => {
      expect(screen.getByText('Cameroon')).toBeInTheDocument();
    });
    expect(screen.getByText('Douala')).toBeInTheDocument();
    expect(screen.getByText('Bonamoussadi')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument();
    expect(screen.getByText('69')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('Community A1 (52), Community A2 (17)')).toBeInTheDocument();
  });

  it('shows a loading state before the fetch resolves', () => {
    mockFetchByUrl({ '/api/admin/locations': { status: 200, body: ONE_GROUP } });
    render(<LocationsTab includeTestData={false} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an empty state when there is no location data', async () => {
    mockFetchByUrl({
      '/api/admin/locations': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } },
    });

    render(<LocationsTab includeTestData={false} />);

    await waitFor(() => {
      expect(screen.getByText('No members have shared a location yet.')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({ '/api/admin/locations': { status: 500, body: { error: 'boom' } } });

    render(<LocationsTab includeTestData={false} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load location data.')).toBeInTheDocument();
    });
  });

  it('never displays individual member personal information', async () => {
    mockFetchByUrl({ '/api/admin/locations': { status: 200, body: ONE_GROUP } });

    render(<LocationsTab includeTestData={false} />);

    await waitFor(() => {
      expect(screen.getByText('Cameroon')).toBeInTheDocument();
    });
    expect(screen.queryByText(/whatsapp/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/admin/locations': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } },
    });

    render(<LocationsTab includeTestData={false} />);

    await waitFor(() => {
      expect(screen.getByText('Localisations')).toBeInTheDocument();
    });
    expect(screen.getByText("Aucun membre n'a encore partagé de localisation.")).toBeInTheDocument();
  });
});
