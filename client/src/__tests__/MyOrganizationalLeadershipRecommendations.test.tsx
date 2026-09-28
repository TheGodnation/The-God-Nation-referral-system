import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyOrganizationalLeadershipRecommendations } from '../components/leader/MyOrganizationalLeadershipRecommendations';
import i18n from '../i18n';

// Phase 2C — mirrors the exact fetch-mocking pattern established in
// MyLeadershipProposals.test.tsx (Phase 3L) and MyMembers.test.tsx (Phase
// 3H — multi-endpoint dispatch).
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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
  calls.length = 0;
  i18n.changeLanguage('en');
});

const ONE_COMMUNITY_ROLE = {
  items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }],
};

describe('MyOrganizationalLeadershipRecommendations', () => {
  it('shows the creation form restricted to a Community the Leader leads', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_COMMUNITY_ROLE },
      '/api/leader/organizational-leadership-recommendations': { status: 200, body: { items: [] } },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('Organizational Leadership Recommendations')).toBeInTheDocument();
    });
    expect(screen.queryByText('You do not currently lead any Community.')).not.toBeInTheDocument();
  });

  it('shows a message when the Leader leads no Community', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: { items: [] } },
      '/api/leader/organizational-leadership-recommendations': { status: 200, body: { items: [] } },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('You do not currently lead any Community.')).toBeInTheDocument();
    });
  });

  it('searches for a candidate scoped to the selected Community and selects them', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_COMMUNITY_ROLE },
      '/api/leader/organizational-leadership-recommendations': { status: 200, body: { items: [] } },
      '/api/leader/scoped-people': { status: 200, body: { items: [{ id: 'p1', name: 'Jane Doe', whatsappNumber: '+123456' }] } },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search this Community's members by name or WhatsApp number")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search this Community's members by name or WhatsApp number"), {
      target: { value: 'Jane' },
    });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(screen.getByText('Jane Doe (+123456)')).toBeInTheDocument();
    });

    const scopedCall = calls.find((c) => c.url.includes('/api/leader/scoped-people'));
    expect(scopedCall!.url).toContain('contextType=COMMUNITY');
    expect(scopedCall!.url).toContain('contextId=c1');
  });

  it('creates a recommendation and shows a success message', async () => {
    let created = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/api/leader/role-assignments')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ONE_COMMUNITY_ROLE });
        }
        if (url.includes('/api/leader/scoped-people')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ items: [{ id: 'p1', name: 'Jane Doe', whatsappNumber: '+123456' }] }) });
        }
        if (method === 'POST' && url.includes('/api/leader/organizational-leadership-recommendations')) {
          created = true;
          return Promise.resolve({ ok: true, status: 201, headers: { get: () => 'application/json' }, json: async () => ({ id: 'rec-1', status: 'PROPOSED' }) });
        }
        const items = created
          ? [
              {
                id: 'rec-1',
                status: 'PROPOSED',
                note: null,
                createdAt: '2026-01-10T00:00:00Z',
                decidedAt: null,
                decisionNote: null,
                generation: 1,
                proposedPerson: { id: 'p1', name: 'Jane Doe' },
                community: { id: 'c1', name: 'My Community' },
              },
            ]
          : [];
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ items }) });
      }),
    );

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search this Community's members by name or WhatsApp number")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("Search this Community's members by name or WhatsApp number"), { target: { value: 'Jane' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('Jane Doe (+123456)')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('Select'));

    await waitFor(() => {
      expect(screen.getByText('Submit recommendation')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Submit recommendation'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/leader/organizational-leadership-recommendations'));
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toEqual({ proposedPersonId: 'p1', communityId: 'c1' });
    });

    await waitFor(() => {
      expect(screen.getByText('Recommendation submitted.')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  it('shows Approved and Rejected statuses', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_COMMUNITY_ROLE },
      '/api/leader/organizational-leadership-recommendations': {
        status: 200,
        body: {
          items: [
            { id: 'rec-approved', status: 'APPROVED', note: null, createdAt: '2026-01-01T00:00:00Z', decidedAt: '2026-01-02T00:00:00Z', decisionNote: null, generation: 1, proposedPerson: { id: 'p1', name: 'Approved Person' }, community: { id: 'c1', name: 'My Community' } },
            { id: 'rec-rejected', status: 'REJECTED', note: null, createdAt: '2026-01-01T00:00:00Z', decidedAt: '2026-01-02T00:00:00Z', decisionNote: null, generation: 1, proposedPerson: { id: 'p2', name: 'Rejected Person' }, community: { id: 'c1', name: 'My Community' } },
          ],
        },
      },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('Approved Person')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected Person')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByText('Withdraw recommendation')).not.toBeInTheDocument();
  });

  it('withdraws a PROPOSED recommendation', async () => {
    let withdrawn = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/api/leader/role-assignments')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ONE_COMMUNITY_ROLE });
        }
        if (url.includes('/withdraw')) {
          withdrawn = true;
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 'rec-1', status: 'WITHDRAWN' }) });
        }
        const items = withdrawn
          ? []
          : [{ id: 'rec-1', status: 'PROPOSED', note: null, createdAt: '2026-01-10T00:00:00Z', decidedAt: null, decisionNote: null, generation: 1, proposedPerson: { id: 'p1', name: 'Candidate Person' }, community: { id: 'c1', name: 'My Community' } }];
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ items }) });
      }),
    );

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Withdraw recommendation'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.url.includes('/api/leader/organizational-leadership-recommendations/rec-1/withdraw'));
      expect(postCall).toBeTruthy();
      expect(postCall!.method).toBe('POST');
    });
    await waitFor(() => {
      expect(screen.queryByText('Candidate Person')).not.toBeInTheDocument();
    });
  });

  it('shows an empty state when there are no recommendations', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_COMMUNITY_ROLE },
      '/api/leader/organizational-leadership-recommendations': { status: 200, body: { items: [] } },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('No recommendations yet.')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading recommendations fails', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_COMMUNITY_ROLE },
      '/api/leader/organizational-leadership-recommendations': { status: 500, body: { error: 'boom' } },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load recommendations.')).toBeInTheDocument();
    });
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_COMMUNITY_ROLE },
      '/api/leader/organizational-leadership-recommendations': { status: 200, body: { items: [] } },
    });

    render(<MyOrganizationalLeadershipRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('Recommandations de leadership organisationnel')).toBeInTheDocument();
    });
    expect(screen.getByText('Aucune recommandation pour le moment.')).toBeInTheDocument();
  });
});
