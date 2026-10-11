import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RoleAssignmentsTab } from '../components/admin/RoleAssignmentsTab';

// Geography Retirement Step 5B — the create-assignment form used to offer a
// Community/Geography scope-type selector; Geography-scoped leadership is
// retired entirely now, so Community is the only, unconditional option
// (same convention as Step 4's AnnouncementsTab and Step 5A's FollowUpsTab).
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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

describe('RoleAssignmentsTab (Admin) — Geography Retirement Step 5B', () => {
  it('1-2. the create form offers no scope-type selector and no Geography option — Community is the only, always-visible scope picker', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<RoleAssignmentsTab />);
    await screen.findByText('+ New Assignment');

    // The only pre-existing comboboxes are the two unrelated status filters
    // (role assignments' own, and organizational recommendations') — no
    // scope-type selector was added back in their place.
    const beforeOptionSets = screen.getAllByRole('combobox').map((el) => el.textContent);

    fireEvent.click(screen.getByText('+ New Assignment'));

    expect(screen.queryByText('Geography')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search communities by name')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox').map((el) => el.textContent)).toEqual(beforeOptionSets);
  });

  it('creates a Community-scoped assignment and reloads the list', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
      '/api/admin/people?search=': { status: 200, body: { items: [{ id: 'person-1', name: 'Jane Doe', whatsappNumber: '+237600000001' }] } },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'community-1', name: 'Youth Ministry' }] } },
    });

    render(<RoleAssignmentsTab />);
    await screen.findByText('+ New Assignment');

    // The status filters (role assignments + org recommendations) are
    // always-present comboboxes, rendered AFTER the create form in the DOM
    // — a SearchPicker's own result dropdown is always inserted before them,
    // so it always lands at index 0 once it appears.
    const baselineComboboxCount = screen.getAllByRole('combobox').length;

    fireEvent.click(screen.getByText('+ New Assignment'));

    // The Person picker and the Community (scope) picker are both visible
    // at once (not revealed sequentially) — picked by DOM order, same
    // convention as this codebase's other multi-picker admin forms.
    fireEvent.change(screen.getByPlaceholderText('Search by name or WhatsApp number'), { target: { value: 'Jane' } });
    fireEvent.click(screen.getAllByText('Search')[0]);
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(baselineComboboxCount + 1));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'person-1' } });
    fireEvent.click(screen.getAllByText('Select')[0]);
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(baselineComboboxCount));

    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'Youth' } });
    fireEvent.click(screen.getAllByText('Search')[0]);
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(baselineComboboxCount + 1));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'community-1' } });
    fireEvent.click(screen.getAllByText('Select')[0]);

    fireEvent.click(screen.getByText('Create Assignment'));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/role-assignments');
      expect(createCall).toBeTruthy();
      expect((createCall!.body as any)).toEqual({ personId: 'person-1', roleType: 'SCOPED_LEADER', communityId: 'community-1' });
    });
  });

  it('3-4. Community remains as the scope label for existing rows in the list, and Geography never appears', async () => {
    mockFetchByUrl({
      '/api/admin/role-assignments': {
        status: 200,
        body: {
          items: [
            {
              id: 'r1',
              roleType: 'SCOPED_LEADER',
              status: 'ACTIVE',
              assignedAt: '2026-01-01T00:00:00Z',
              endedAt: null,
              person: { id: 'p1', name: 'Jane Doe', whatsappNumber: '+237600000001' },
              community: { id: 'c1', name: 'Youth Ministry' },
              assignedBy: { id: 'a1', name: 'Admin', email: 'admin@test.local' },
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
      '/api/admin/organizational-leadership-recommendations': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<RoleAssignmentsTab />);

    await waitFor(() => {
      expect(screen.getByText('Community: Youth Ministry')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Geography:/)).not.toBeInTheDocument();
  });

  it('7-8. English and French i18n remain correct for the remaining scope labels', async () => {
    const en = await import('../i18n/en.json');
    const fr = await import('../i18n/fr.json');
    expect((en.default as any).admin.roleAssignments.scope_community).toBe('Community');
    expect((fr.default as any).admin.roleAssignments.scope_community).toBe('Communauté');
    expect((en.default as any).admin.roleAssignments.scope_geography).toBeUndefined();
    expect((fr.default as any).admin.roleAssignments.scope_geography).toBeUndefined();
  });
});
