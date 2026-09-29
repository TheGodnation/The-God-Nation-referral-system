import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { PeopleTab } from '../components/admin/PeopleTab';

// Book / Resource Access Grants — Admin's per-Person "Resource Access"
// section within PeopleTab.tsx. Same URL-dispatching fetch mock pattern
// established across prior client tests.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 200, body: { items: [] } };
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

const PERSON_LIST = {
  items: [{ id: 'p1', name: 'Grace Doe', whatsappNumber: '+237600000000', email: null, geographicAssignment: null, _count: { communityMemberships: 0, registrations: 0 } }],
  pagination: { totalPages: 1 },
};

const PERSON_DETAIL = {
  id: 'p1',
  name: 'Grace Doe',
  whatsappNumber: '+237600000000',
  email: null,
  preferredLanguage: 'en',
  geographicAssignment: null,
  communityMemberships: [],
  registrations: [],
  users: [],
};

function baseResponses(extra: Record<string, { status: number; body: unknown }> = {}) {
  return {
    '/api/admin/people/p1/training-progress': { status: 200, body: { totalEligible: 0, completedCount: 0, items: [] } },
    '/api/admin/people/p1': { status: 200, body: PERSON_DETAIL },
    '/api/admin/people': { status: 200, body: PERSON_LIST },
    ...extra,
  };
}

describe('PeopleTab — Resource Access section', () => {
  it('shows existing resource access grants for the selected Person, with active/revoked status', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/people/p1/resource-access': {
          status: 200,
          body: {
            items: [
              { id: 'g1', status: 'ACTIVE', grantedAt: '2026-01-01T00:00:00Z', revokedAt: null, resource: { id: 'r1', titleEn: 'Foundations of Faith', titleFr: null, active: true } },
            ],
          },
        },
      }),
    );

    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('View'));

    await waitFor(() => {
      expect(screen.getByText('Resource Access')).toBeInTheDocument();
    });
    expect(screen.getByText(/Foundations of Faith/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoke')).toBeInTheDocument();
  });

  it('shows an empty state when the Person has no resource access grants', async () => {
    mockFetchByUrl(baseResponses({ '/api/admin/people/p1/resource-access': { status: 200, body: { items: [] } } }));

    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('View'));

    await waitFor(() => {
      expect(screen.getByText('No resource access grants yet.')).toBeInTheDocument();
    });
  });

  it('grants a Resource to the Person via the search picker', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/people/p1/resource-access': { status: 200, body: { items: [] } },
        '/api/admin/resources?search=Faith': { status: 200, body: { items: [{ id: 'r1', titleEn: 'Foundations of Faith' }] } },
      }),
    );

    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('View'));
    await waitFor(() => expect(screen.getByText('Resource Access')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText('Search resources by title');
    const pickerContainer = searchInput.closest('div')!;
    fireEvent.change(searchInput, { target: { value: 'Faith' } });
    fireEvent.click(within(pickerContainer).getByText('Search'));

    await waitFor(() => expect(within(pickerContainer).getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(within(pickerContainer).getByRole('combobox'), { target: { value: 'r1' } });
    fireEvent.click(within(pickerContainer).getByText('Grant Access'));

    await waitFor(() => {
      const grantCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/admin/people/p1/resource-access'));
      expect(grantCall).toBeTruthy();
      expect((grantCall!.body as any).resourceId).toBe('r1');
    });
  });

  it('revokes an active grant', async () => {
    mockFetchByUrl(
      baseResponses({
        '/api/admin/people/p1/resource-access': {
          status: 200,
          body: {
            items: [
              { id: 'g1', status: 'ACTIVE', grantedAt: '2026-01-01T00:00:00Z', revokedAt: null, resource: { id: 'r1', titleEn: 'Foundations of Faith', titleFr: null, active: true } },
            ],
          },
        },
        '/api/admin/resource-access/g1/revoke': { status: 200, body: { id: 'g1', status: 'REVOKED', grantedAt: '2026-01-01T00:00:00Z', revokedAt: '2026-01-02T00:00:00Z', resource: { id: 'r1', titleEn: 'Foundations of Faith', titleFr: null, active: true } } },
      }),
    );

    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByText('View'));
    await waitFor(() => expect(screen.getByText('Revoke')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Revoke'));

    await waitFor(() => {
      const revokeCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/api/admin/resource-access/g1/revoke'));
      expect(revokeCall).toBeTruthy();
    });
  });
});
