import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ManageCommunitiesPanel } from '../components/admin/ManageCommunitiesPanel';
import { GroupLeadersPanel } from '../components/admin/GroupLeadersPanel';

const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => {
        const [m, path] = k.split(' ');
        return m === method && url.startsWith(path);
      });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const C = '/api/member/central-communities';
const hq = { id: 'hq', name: 'National HQ', kind: 'ASSEMBLY', parentId: null, parent: null, generation: 0, _count: { children: 2, memberships: 40 } };
const prayer = { id: 'g1', name: 'Prayer Group', kind: 'GROUP', parentId: 'hq', parent: { id: 'hq', name: 'National HQ' }, generation: 0, _count: { children: 0, memberships: 6 } };

describe('ManageCommunitiesPanel (the central admin’s profile)', () => {
  it('shows assemblies and groups with their generation, and opens one to see what is inside', async () => {
    mockFetch({
      [`GET ${C}?&page`]: () => ({ body: { items: [hq] } }),
      [`GET ${C}?parentId=hq`]: () => ({ body: { items: [prayer] } }),
    });
    render(<ManageCommunitiesPanel base={C} />);
    const rows = await screen.findAllByTestId('manage-row');
    expect(rows[0]).toHaveTextContent('National HQ');
    expect(rows[0]).toHaveTextContent('Assembly');
    expect(rows[0]).toHaveTextContent('Founding generation (0)');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    const inner = await screen.findByText('Prayer Group');
    const row = inner.closest('[data-testid="manage-row"]') as HTMLElement;
    expect(row).toHaveTextContent('Group');
    expect(row).toHaveTextContent('Founding generation (0)'); // a group keeps its assembly's generation
    expect(row).toHaveTextContent('inside National HQ');
  });

  it('renames a group and changes its type', async () => {
    mockFetch({
      [`GET ${C}?parentId=hq`]: () => ({ body: { items: [prayer] } }),
      [`GET ${C}?&page`]: () => ({ body: { items: [hq] } }),
      [`PATCH ${C}/g1`]: () => ({ body: { id: 'g1' } }),
    });
    render(<ManageCommunitiesPanel base={C} />);
    fireEvent.click(within((await screen.findAllByTestId('manage-row'))[0]).getByRole('button', { name: 'Open' }));
    const row = (await screen.findByText('Prayer Group')).closest('[data-testid="manage-row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Rename or change type' }));
    const form = within(row).getByTestId('manage-edit');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Leadership Team' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Leadership Team', kind: 'GROUP' });
  });

  it('adds a group inside an assembly, and offers only assemblies at the top level', async () => {
    mockFetch({
      [`GET ${C}?parentId=hq`]: () => ({ body: { items: [] } }),
      [`GET ${C}?&page`]: () => ({ body: { items: [hq] } }),
      [`POST ${C}`]: () => ({ status: 201, body: { id: 'new' } }),
    });
    render(<ManageCommunitiesPanel base={C} />);
    // At the top level a group cannot be created (it needs an assembly).
    fireEvent.click(await screen.findByRole('button', { name: /New assembly at the top level/ }));
    expect(screen.getByLabelText(/A group inside this assembly/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Inside the Headquarters: a group.
    fireEvent.click(within((await screen.findAllByTestId('manage-row'))[0]).getByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('button', { name: /New in National HQ/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Women' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === C)?.body).toEqual({ name: 'Women', kind: 'GROUP', parentId: 'hq', autoPlacementEligible: false }));
  });

  it('deletes with the typed name and says where the members go', async () => {
    mockFetch({
      [`GET ${C}?&page`]: () => ({ body: { items: [prayer] } }),
      [`GET ${C}/g1/delete-impact`]: () => ({ body: { id: 'g1', name: 'Prayer Group', isHeadquarters: false, members: 6, subAssemblies: 0, messages: 12, teachings: 0, events: 0 } }),
      [`DELETE ${C}/g1`]: () => ({ body: { deleted: true } }),
    });
    render(<ManageCommunitiesPanel base={C} />);
    const row = (await screen.findByText('Prayer Group')).closest('[data-testid="manage-row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(await within(row).findByText(/12 messages/)).toBeInTheDocument();
    expect(within(row).getByLabelText(/Move them to National HQ/)).toBeChecked();
    fireEvent.change(within(row).getByLabelText(/Type the assembly name/), { target: { value: 'Prayer Group' } });
    fireEvent.click(within(row).getByRole('button', { name: /Yes, delete permanently/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ confirmName: 'Prayer Group', moveMembersTo: 'hq' }));
  });
});

describe('GroupLeadersPanel', () => {
  const G = '/api/member/central-groups';
  const groups = [
    { id: 'g1', name: 'Prayer Group', assemblyName: 'National HQ', generation: 0, leaders: [] },
    { id: 'g2', name: 'Youth A', assemblyName: 'Alpha', generation: 1, leaders: [{ id: 'p9', name: 'Yan Youth' }] },
  ];
  it('lists the groups with their leaders and makes a member of the group or assembly its leader', async () => {
    mockFetch({
      [`GET ${G}/groups`]: () => ({ body: { items: groups } }),
      [`GET ${G}/candidates`]: () => ({ body: { items: [{ id: 'p1', name: 'Ada Member', whatsappNumber: '+2371' }] } }),
      [`POST ${G}/leader`]: () => ({ status: 201, body: { id: 'r1' } }),
    });
    render(<GroupLeadersPanel base={G} />);
    const rows = await screen.findAllByTestId('group-row');
    expect(rows[0]).toHaveTextContent('Group of National HQ');
    expect(rows[0]).toHaveTextContent('founding generation (0)');
    expect(rows[0]).toHaveTextContent('No leader yet.');
    expect(rows[1]).toHaveTextContent('Led by Yan Youth');
    expect(rows[1]).toHaveTextContent('generation 1');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Choose a leader' }));
    fireEvent.click(await within(rows[0]).findByRole('button', { name: 'Make leader' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ communityId: 'g1', personId: 'p1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ada Member now leads Prayer Group.');
  });

  it('says when it is not available (a representative with no group, or not a representative)', async () => {
    mockFetch({ [`GET ${G}/groups`]: () => ({ status: 403, body: { error: 'Only the representative of a generation can use this.' } }) });
    render(<GroupLeadersPanel base={G} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the representative');
  });
});
