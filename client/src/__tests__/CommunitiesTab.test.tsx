import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CommunitiesTab } from '../components/admin/CommunitiesTab';
import i18n from '../i18n';

// National Headquarters designation + derived generation display. Mirrors
// the exact URL-dispatching fetch mock pattern established in
// CommunityGeographyReparenting.test.tsx.
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

const emptyList = { items: [], pagination: { totalPages: 1 } };

describe('CommunitiesTab — National Headquarters designation', () => {
  it('shows "no Headquarters" when none is configured', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
    });

    render(<CommunitiesTab />);

    await waitFor(() => {
      expect(screen.getByText('No National Headquarters has been designated yet.')).toBeInTheDocument();
    });
  });

  it('shows the currently designated Headquarters', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: { id: 'hq-1', name: 'National HQ' } } },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
    });

    render(<CommunitiesTab />);

    await waitFor(() => {
      expect(screen.getByText('Current Headquarters: National HQ')).toBeInTheDocument();
    });
  });

  it('designating a Community via search updates the displayed Headquarters', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'root-1', name: 'Root Community' }] } },
    });

    render(<CommunitiesTab />);
    await screen.findByText('No National Headquarters has been designated yet.');

    fireEvent.change(screen.getByPlaceholderText('Search for a community to designate as Headquarters'), {
      target: { value: 'Root' },
    });
    fireEvent.click(screen.getByText('Find'));

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'root-1' } });

    // The PUT response must be registered before the click that triggers it.
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: { id: 'root-1', name: 'Root Community' } } },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'root-1', name: 'Root Community' }] } },
    });
    fireEvent.click(screen.getByText('Designate as Headquarters'));

    await waitFor(() => {
      expect(screen.getByText('Current Headquarters: Root Community')).toBeInTheDocument();
    });
    const putCall = calls.find((c) => c.method === 'PUT' && c.url.includes('/communities/headquarters'));
    expect(putCall!.body).toEqual({ communityId: 'root-1' });
  });

  it('shows a validation error when the server rejects the designation (e.g. a non-root Community)', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'child-1', name: 'Child Community' }] } },
    });

    render(<CommunitiesTab />);
    await screen.findByText('No National Headquarters has been designated yet.');

    fireEvent.change(screen.getByPlaceholderText('Search for a community to designate as Headquarters'), {
      target: { value: 'Child' },
    });
    fireEvent.click(screen.getByText('Find'));
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'child-1' } });

    mockFetchByUrl({
      '/api/admin/communities/headquarters': {
        status: 400,
        body: { error: 'Only a root Community (no parent) may be designated as National Headquarters.' },
      },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
    });
    fireEvent.click(screen.getByText('Designate as Headquarters'));

    await waitFor(() => {
      expect(
        screen.getByText('Only a root Community (no parent) may be designated as National Headquarters.'),
      ).toBeInTheDocument();
    });
    // Still shows "none configured" — the rejected attempt never took effect.
    expect(screen.getByText('No National Headquarters has been designated yet.')).toBeInTheDocument();
  });

  it('renders the derived generation for each Community, with a distinct label for Headquarters itself', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: { id: 'hq-1', name: 'HQ' } } },
      '/api/admin/communities?&page=': {
        status: 200,
        body: {
          items: [
            { id: 'hq-1', name: 'HQ', active: true, parentId: null, generation: 0, _count: { children: 1, memberships: 0 } },
            { id: 'a-1', name: 'Community A', active: true, parentId: 'hq-1', generation: 1, _count: { children: 0, memberships: 0 } },
            { id: 'x-1', name: 'Unrelated Root', active: true, parentId: null, generation: null, _count: { children: 0, memberships: 0 } },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<CommunitiesTab />);

    await waitFor(() => expect(screen.getByText('HQ')).toBeInTheDocument());
    // "National Headquarters" appears twice: the heading above the table,
    // and the generation-0 label on the HQ row itself.
    expect(screen.getAllByText('National Headquarters')).toHaveLength(2);
    expect(screen.getByText('Generation 1')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: emptyList },
    });

    render(<CommunitiesTab />);

    await waitFor(() => {
      expect(screen.getByText("Aucun quartier général national n'a encore été désigné.")).toBeInTheDocument();
    });
  });
});
