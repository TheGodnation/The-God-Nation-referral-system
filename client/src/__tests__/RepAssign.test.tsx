import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RepAssignPanel } from '../components/admin/RepAssignPanel';

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

const R = '/api/member/rep-cells';
describe('RepAssignPanel (a representative)', () => {
  it('lists the assemblies of their generation and runs the preview and the assignment on the representative address', async () => {
    mockFetch({
      [`GET ${R}/overview`]: () => ({ body: { generation: 1, items: [{ id: 'c1', name: 'Alpha', members: 20, leaders: 2, unassigned: 8 }, { id: 'c2', name: 'Beta', members: 5, leaders: 1, unassigned: 0 }] } }),
      [`GET ${R}/leaders`]: () => ({ body: { items: [{ personId: 'l1', name: 'Leo', headcount: 3, away: false }, { personId: 'l2', name: 'Lea', headcount: 1, away: false }] } }),
      [`POST ${R}/share`]: (b) => ({ body: { assigned: b.dryRun ? 8 : 8, remaining: 0, noLeaders: false, dryRun: Boolean(b.dryRun), perLeader: [{ personId: 'l1', name: 'Leo', added: 4 }, { personId: 'l2', name: 'Lea', added: 4 }] } }),
    });
    render(<RepAssignPanel />);
    const rows = await screen.findAllByTestId('rep-assign-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText(/generation 1/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/20 members · 2 leaders · 8 not followed yet/)).toBeInTheDocument();
    // Nothing to give in Beta, so no button there.
    expect(within(rows[1]).queryByRole('button', { name: 'Assign people' })).toBeNull();

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Assign people' }));
    await screen.findByText('Leo');
    expect(calls.some((c) => c.url === `${R}/leaders?communityId=c1`)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show me who would get whom' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${R}/share` && c.body.dryRun === true && c.body.communityId === 'c1')).toBe(true));
  });

  it('says clearly when it is not available to them', async () => {
    mockFetch({ [`GET ${R}/overview`]: () => ({ status: 403, body: { error: 'Only the representative of a generation can use this.' } }) });
    render(<RepAssignPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the representative of a generation can use this.');
  });
});
