import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CommunitiesTab } from '../components/admin/CommunitiesTab';

// Phase 3G — same URL-dispatching fetch mock pattern established in
// MemberDashboardProfile.test.tsx / TrainingProgress.test.tsx. Records
// every call so the test can assert exactly what the reparent PATCH sent.
// Originally shared this file with GeographyTab's own reparenting coverage
// (CommunityGeographyReparenting.test.tsx); Final Geography Retirement
// removed the Geography model and GeographyTab entirely, so this file (and
// its name) is Community-only now.
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
});

describe('CommunitiesTab — Phase 3G reparenting', () => {
  it('sends the correct parentId when reparenting via the edit form', async () => {
    mockFetchByUrl({
      '/api/admin/communities?&page=': {
        status: 200,
        body: { items: [{ id: 'community-1', name: 'Child Community', active: true, parentId: null, parent: null, _count: { children: 0, memberships: 0 } }], pagination: { totalPages: 1 } },
      },
      '/api/admin/communities?search=': {
        status: 200,
        body: { items: [{ id: 'community-2', name: 'New Parent Community' }] },
      },
      '/api/admin/communities/community-1': {
        status: 200,
        body: { id: 'community-1', name: 'Child Community', active: true, parentId: 'community-2' },
      },
    });

    render(<CommunitiesTab />);

    fireEvent.click(await screen.findByText('Edit'));

    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'New Parent' } });
    fireEvent.click(screen.getByText('Search'));

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'community-2' } });
    fireEvent.click(screen.getByText('Select'));

    expect(await screen.findByText('New Parent Community', { selector: 'p' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url === '/api/admin/communities/community-1' && c.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(patchCall!.body).toEqual({ name: 'Child Community', parentId: 'community-2' });
    });
  });

  it('shows the existing error state when the server rejects the reparent (e.g. a cycle)', async () => {
    mockFetchByUrl({
      '/api/admin/communities?&page=': {
        status: 200,
        body: { items: [{ id: 'community-1', name: 'Grandparent Community', active: true, parentId: null, parent: null, _count: { children: 0, memberships: 0 } }], pagination: { totalPages: 1 } },
      },
      '/api/admin/communities?search=': {
        status: 200,
        body: { items: [{ id: 'community-3', name: 'Its Own Descendant' }] },
      },
      '/api/admin/communities/community-1': {
        status: 400,
        body: { error: 'This would make the community a descendant of itself.' },
      },
    });

    render(<CommunitiesTab />);

    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'descendant' } });
    fireEvent.click(screen.getByText('Search'));
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'community-3' } });
    fireEvent.click(screen.getByText('Select'));
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(screen.getByText('This would make the community a descendant of itself.')).toBeInTheDocument();
    });
  });
});
