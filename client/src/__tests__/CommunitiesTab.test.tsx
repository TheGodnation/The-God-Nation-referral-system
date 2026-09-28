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

describe('CommunitiesTab — Community Posting Policy', () => {
  const oneEveryoneCommunity = {
    items: [
      { id: 'c-1', name: 'Everyone Community', active: true, parentId: null, postingPolicy: 'EVERYONE', generation: null, _count: { children: 0, memberships: 0 } },
    ],
    pagination: { totalPages: 1 },
  };

  it('shows the current posting policy for each Community', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: oneEveryoneCommunity },
    });

    render(<CommunitiesTab />);

    await waitFor(() => expect(screen.getByText('Everyone Community')).toBeInTheDocument());
    expect(screen.getByText('Everyone')).toBeInTheDocument();
    expect(screen.getByText('Set to Leaders only')).toBeInTheDocument();
  });

  it('an Admin can change a Community from Everyone to Leaders Only', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: oneEveryoneCommunity },
    });

    render(<CommunitiesTab />);
    await waitFor(() => expect(screen.getByText('Everyone Community')).toBeInTheDocument());

    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities/c-1': { status: 200, body: { ...oneEveryoneCommunity.items[0], postingPolicy: 'LEADERS_ONLY' } },
      '/api/admin/communities?&page=': {
        status: 200,
        body: {
          items: [{ ...oneEveryoneCommunity.items[0], postingPolicy: 'LEADERS_ONLY' }],
          pagination: { totalPages: 1 },
        },
      },
    });
    fireEvent.click(screen.getByText('Set to Leaders only'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('c-1'));
      expect(patchCall).toBeTruthy();
      expect(patchCall!.body).toEqual({ postingPolicy: 'LEADERS_ONLY' });
    });
    await waitFor(() => expect(screen.getByText('Leaders only')).toBeInTheDocument());
    expect(screen.getByText('Set to Everyone')).toBeInTheDocument();
  });

  it('an Admin can change a Community from Leaders Only back to Everyone', async () => {
    const leadersOnlyCommunity = {
      items: [{ id: 'c-2', name: 'Leaders Only Community', active: true, parentId: null, postingPolicy: 'LEADERS_ONLY', generation: null, _count: { children: 0, memberships: 0 } }],
      pagination: { totalPages: 1 },
    };
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: leadersOnlyCommunity },
    });

    render(<CommunitiesTab />);
    await waitFor(() => expect(screen.getByText('Leaders Only Community')).toBeInTheDocument());

    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities/c-2': { status: 200, body: { ...leadersOnlyCommunity.items[0], postingPolicy: 'EVERYONE' } },
      '/api/admin/communities?&page=': {
        status: 200,
        body: { items: [{ ...leadersOnlyCommunity.items[0], postingPolicy: 'EVERYONE' }], pagination: { totalPages: 1 } },
      },
    });
    fireEvent.click(screen.getByText('Set to Everyone'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('c-2'));
      expect(patchCall!.body).toEqual({ postingPolicy: 'EVERYONE' });
    });
    await waitFor(() => expect(screen.getByText('Everyone')).toBeInTheDocument());
  });

  it('shows a saving indicator while the policy update is in flight, and disables the control', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: oneEveryoneCommunity },
    });

    render(<CommunitiesTab />);
    await waitFor(() => expect(screen.getByText('Everyone Community')).toBeInTheDocument());

    let resolvePatch: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return new Promise<any>((resolve) => {
            resolvePatch = () =>
              resolve({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ ...oneEveryoneCommunity.items[0], postingPolicy: 'LEADERS_ONLY' }),
              });
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => oneEveryoneCommunity,
        });
      }),
    );

    const toggleButton = screen.getByText('Set to Leaders only') as HTMLButtonElement;
    fireEvent.click(toggleButton);

    await waitFor(() => expect(screen.getByText('Saving…')).toBeInTheDocument());
    expect(toggleButton.disabled).toBe(true);

    resolvePatch?.();
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  });

  it('shows an error when the policy update fails, and leaves the value unchanged', async () => {
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: oneEveryoneCommunity },
    });

    render(<CommunitiesTab />);
    await waitFor(() => expect(screen.getByText('Everyone Community')).toBeInTheDocument());

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'boom' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => oneEveryoneCommunity,
        });
      }),
    );

    fireEvent.click(screen.getByText('Set to Leaders only'));

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
    // The value shown is unchanged — the rejected attempt never took effect.
    expect(screen.getByText('Everyone')).toBeInTheDocument();
  });

  it('renders posting policy labels in French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/admin/communities/headquarters': { status: 200, body: { community: null } },
      '/api/admin/communities?&page=': { status: 200, body: oneEveryoneCommunity },
    });

    render(<CommunitiesTab />);

    await waitFor(() => expect(screen.getByText('Everyone Community')).toBeInTheDocument());
    expect(screen.getByText('Tout le monde')).toBeInTheDocument();
    expect(screen.getByText('Définir sur Leaders uniquement')).toBeInTheDocument();
  });
});
