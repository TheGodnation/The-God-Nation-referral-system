import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RoleAssignmentsTab } from '../components/admin/RoleAssignmentsTab';
import i18n from '../i18n';

// Phase 3L — Admin "Leadership Proposals" section within RoleAssignmentsTab.
// Same URL-dispatching fetch mock pattern as MyMembersProposeForLeadership.test.tsx.
const calls: { url: string; method: string; body: unknown }[] = [];

const NO_ROLE_ASSIGNMENTS = { items: [], pagination: { totalPages: 1 } };

const ONE_PROPOSED = {
  items: [
    {
      id: 'proposal-1',
      status: 'PROPOSED',
      note: 'Faithful servant.',
      createdAt: '2026-01-10T00:00:00Z',
      decidedAt: null,
      decisionNote: null,
      proposedPerson: { id: 'person-1', name: 'Candidate Person' },
      proposedByPerson: { id: 'person-2', name: 'Leader Person' },
      geography: { id: 'region-1', name: 'My Region', type: 'REGION' },
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

describe('RoleAssignmentsTab — Phase 3L Leadership Proposals', () => {
  it('displays a PROPOSED proposal with candidate, geography, proposer, and note', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getByText('Leader Person')).toBeInTheDocument();
    expect(screen.getByText('My Region (REGION)')).toBeInTheDocument();
    expect(screen.getByText('Faithful servant.')).toBeInTheDocument();
    expect(screen.getAllByText('Pending Review').some((el) => el.tagName === 'SPAN')).toBe(true);
  });

  it('shows Approve and Reject actions for a PROPOSED row, and never an "Approve & Appoint" action', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Approve Recommendation')).toBeInTheDocument();
    });
    expect(screen.getByText('Reject')).toBeInTheDocument();
    expect(screen.queryByText(/approve\s*&?\s*appoint/i)).not.toBeInTheDocument();
    expect(
      screen.getByText('Approving a recommendation does not create a formal appointment. To officially appoint this person, use the New Assignment form above.'),
    ).toBeInTheDocument();
  });

  it('approves a proposal with an optional decision note and reloads the list', async () => {
    let approved = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/api/admin/role-assignments')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => NO_ROLE_ASSIGNMENTS,
          });
        }
        if (url.includes('/approve')) {
          approved = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'proposal-1', status: 'APPROVED' }),
          });
        }
        const body = approved
          ? {
              items: [{ ...ONE_PROPOSED.items[0], status: 'APPROVED', decidedAt: '2026-01-12T00:00:00Z', decidedByUser: { id: 'admin-1', name: 'Admin One', email: 'admin@example.com' } }],
              pagination: { totalPages: 1 },
            }
          : ONE_PROPOSED;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => body,
        });
      }),
    );

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Approve Recommendation')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Optional decision note');
    fireEvent.change(textarea, { target: { value: 'Confirmed with council.' } });
    fireEvent.click(screen.getByText('Approve Recommendation'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url.includes('/api/admin/leadership-proposals/proposal-1/approve'));
      expect(patchCall).toBeTruthy();
      expect(patchCall!.method).toBe('PATCH');
      expect(patchCall!.body).toEqual({ decisionNote: 'Confirmed with council.' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Approved (recommendation only)').some((el) => el.tagName === 'SPAN')).toBe(true);
    });
  });

  it('rejects a proposal', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: ONE_PROPOSED },
      '/reject': { status: 200, body: { id: 'proposal-1', status: 'REJECTED' } },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Reject')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reject'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url.includes('/api/admin/leadership-proposals/proposal-1/reject'));
      expect(patchCall).toBeTruthy();
      expect(patchCall!.method).toBe('PATCH');
    });
  });

  it('does not show Approve/Reject actions for a decided proposal', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': {
        status: 200,
        body: {
          items: [
            {
              ...ONE_PROPOSED.items[0],
              status: 'REJECTED',
              decidedAt: '2026-01-12T00:00:00Z',
              decisionNote: 'Not at this time.',
              decidedByUser: { id: 'admin-1', name: 'Admin One', email: 'admin@example.com' },
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getAllByText('Rejected').some((el) => el.tagName === 'SPAN')).toBe(true);
    });
    expect(screen.queryByText('Approve Recommendation')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
    expect(screen.getByText('Not at this time.')).toBeInTheDocument();
    expect(screen.getByText('Decided by Admin One on 1/12/2026')).toBeInTheDocument();
  });

  it('leaves the existing RoleAssignment table and New Assignment form unaffected', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': {
        status: 200,
        body: {
          items: [
            {
              id: 'ra-1',
              roleType: 'SCOPED_LEADER',
              status: 'ACTIVE',
              assignedAt: '2026-01-01T00:00:00Z',
              endedAt: null,
              person: { id: 'p1', name: 'Existing Leader', whatsappNumber: '+10000000000' },
              community: null,
              geography: { id: 'g1', name: 'Existing Region', type: 'REGION' },
              assignedBy: { id: 'a1', name: 'Admin One', email: 'admin@example.com' },
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
      '/api/admin/leadership-proposals': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Existing Leader')).toBeInTheDocument();
    });
    expect(screen.getByText('+ New Assignment')).toBeInTheDocument();
    expect(screen.getByText('No leadership proposals found.')).toBeInTheDocument();
  });

  it('renders the Leadership Proposals section in French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: NO_ROLE_ASSIGNMENTS },
      '/api/admin/leadership-proposals': { status: 200, body: ONE_PROPOSED },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Candidate Person')).toBeInTheDocument();
    });
    expect(screen.getByText('Approuver la recommandation')).toBeInTheDocument();
    expect(screen.queryByText('Approve Recommendation')).not.toBeInTheDocument();
  });
});
