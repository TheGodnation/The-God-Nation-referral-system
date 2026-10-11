import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RoleAssignmentsTab } from '../components/admin/RoleAssignmentsTab';
import i18n from '../i18n';

// Phase 2C — Admin "Organizational Leadership Recommendations" section
// within RoleAssignmentsTab. Same URL-dispatching fetch mock pattern as
// RoleAssignmentsTabLeadershipProposals.test.tsx (Phase 3L).
const calls: { url: string; method: string; body: unknown }[] = [];

const NO_ROLE_ASSIGNMENTS = { items: [], pagination: { totalPages: 1 } };
const NO_PROPOSALS = { items: [], pagination: { totalPages: 1 } };

const ONE_PROPOSED = {
  items: [
    {
      id: 'orgrec-1',
      status: 'PROPOSED',
      note: 'Faithful and ready.',
      createdAt: '2026-01-10T00:00:00Z',
      decidedAt: null,
      decisionNote: null,
      generation: 2,
      proposedPerson: { id: 'person-1', name: 'Candidate Person' },
      proposedByPerson: { id: 'person-2', name: 'Leader Person' },
      community: { id: 'community-1', name: 'My Community' },
      decidedByUser: null,
    },
  ],
  pagination: { totalPages: 1 },
};

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

describe('RoleAssignmentsTab — Phase 2C Organizational Leadership Recommendations', () => {
  it('displays a PROPOSED recommendation with candidate, Community, generation, proposer, and note', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: NO_PROPOSALS },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getByText('Leader Person')).toBeInTheDocument();
    expect(screen.getByText('My Community')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Faithful and ready.')).toBeInTheDocument();
  });

  it('shows Approve and Reject actions for a PROPOSED row, and the Community/appointment separation note', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: NO_PROPOSALS },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Approve Recommendation').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Approving a recommendation does not create a Community or appoint a Leader. Those remain separate actions.'),
    ).toBeInTheDocument();
  });

  it('approves a recommendation with an optional decision note and reloads the list', async () => {
    let approved = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/api/admin/role-assignments')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => NO_ROLE_ASSIGNMENTS });
        }
        if (url.includes('/api/admin/leadership-proposals')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => NO_PROPOSALS });
        }
        if (url.includes('/approve')) {
          approved = true;
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 'orgrec-1', status: 'APPROVED' }) });
        }
        const body = approved
          ? {
              items: [{ ...ONE_PROPOSED.items[0], status: 'APPROVED', decidedAt: '2026-01-12T00:00:00Z', decidedByUser: { id: 'admin-1', name: 'Admin One', email: 'admin@example.com' } }],
              pagination: { totalPages: 1 },
            }
          : ONE_PROPOSED;
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
      }),
    );

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Optional decision note');
    fireEvent.change(textarea, { target: { value: 'Approved by council.' } });
    fireEvent.click(screen.getAllByText('Approve Recommendation')[0]);

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url.includes('/api/admin/organizational-leadership-recommendations/orgrec-1/approve'));
      expect(patchCall).toBeTruthy();
      expect(patchCall!.method).toBe('PATCH');
      expect(patchCall!.body).toEqual({ decisionNote: 'Approved by council.' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Approved (recommendation only)').some((el) => el.tagName === 'SPAN')).toBe(true);
    });
  });

  it('rejects a recommendation', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: NO_PROPOSALS },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: ONE_PROPOSED },
      '/reject': { status: 200, body: { id: 'orgrec-1', status: 'REJECTED' } },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Reject')[0]);

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url.includes('/api/admin/organizational-leadership-recommendations/orgrec-1/reject'));
      expect(patchCall).toBeTruthy();
      expect(patchCall!.method).toBe('PATCH');
    });
  });

  it('does not create a Community, and no "Create Community" or "Assign Leader" button exists in this section', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: NO_PROPOSALS },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.queryByText(/create community/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/assign leader/i)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no organizational recommendations', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: NO_PROPOSALS },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('No organizational leadership recommendations found.')).toBeInTheDocument();
    });
  });

  it('renders the Organizational Leadership Recommendations section in French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: NO_PROPOSALS },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Approuver la recommandation').length).toBeGreaterThan(0);
    expect(screen.getByText('Recommandations de leadership organisationnel')).toBeInTheDocument();
  });
});
