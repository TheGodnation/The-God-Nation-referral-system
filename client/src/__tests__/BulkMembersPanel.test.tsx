import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BulkMembersPanel } from '../components/admin/BulkMembersPanel';

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

const B = '/api/member/central-bulk-members';
const people = [
  { id: 'a', name: 'Ada One', whatsappNumber: '+2371' },
  { id: 'b', name: 'Bea Two', whatsappNumber: '+2372' },
];
const routes = (extra: Record<string, (b: any) => any> = {}) => ({
  [`GET ${B}/generations`]: () => ({ body: { hasHeadquarters: true, generations: [{ generation: 0, assemblies: 1, people: 5 }, { generation: 1, assemblies: 2, people: 2 }], noAssembly: 3 } }),
  [`GET ${B}/people`]: () => ({ body: { items: people, total: 2, page: 1, pageSize: 50 } }),
  [`GET ${B}/ids`]: () => ({ body: { ids: ['a', 'b'], capped: false } }),
  [`GET ${B}/assemblies`]: () => ({ body: { items: [{ id: 'new-hq', name: 'World HQ', generation: 0 }] } }),
  ...extra,
});

describe('BulkMembersPanel', () => {
  it('shows only the chosen generation, selects all, adds them to an existing assembly', async () => {
    mockFetch(routes({
      [`POST ${B}/add`]: () => ({ status: 201, body: { destination: { id: 'new-hq', name: 'World HQ' }, created: false, added: 2, alreadyIn: 0, removed: 0 } }),
    }));
    render(<BulkMembersPanel base={B} />);
    fireEvent.click(await screen.findByRole('button', { name: /Generation 1 · 2 people/ }));
    expect(await screen.findByText('Ada One')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/people?source=gen%3A1'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    await waitFor(() => expect(screen.getByTestId('bulk-selected')).toHaveTextContent('2 selected'));
    // Untick one.
    fireEvent.click(within(screen.getByTestId('bulk-people')).getAllByRole('checkbox')[1]);
    expect(screen.getByTestId('bulk-selected')).toHaveTextContent('1 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));

    const dest = screen.getByTestId('bulk-destination');
    fireEvent.change(within(dest).getByPlaceholderText('Search an assembly by name'), { target: { value: 'World' } });
    fireEvent.click(within(dest).getByRole('button', { name: 'Search' }));
    fireEvent.change(await within(dest).findByRole('combobox'), { target: { value: 'new-hq' } });
    fireEvent.click(within(dest).getByRole('button', { name: 'Choose' }));
    fireEvent.click(await within(dest).findByRole('button', { name: 'Add 2 people' }));

    expect(await screen.findByTestId('bulk-result')).toHaveTextContent('2 added to “World HQ”');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ personIds: ['a', 'b'], destinationId: 'new-hq' });
  });

  it('can create a new assembly and also take people out of the old generation', async () => {
    mockFetch(routes({
      [`POST ${B}/add`]: () => ({ status: 201, body: { destination: { id: 'n1', name: 'Brand New' }, created: true, added: 2, alreadyIn: 0, removed: 2 } }),
    }));
    render(<BulkMembersPanel base={B} />);
    fireEvent.click(await screen.findByRole('button', { name: /Generation 1 · 2 people/ }));
    await screen.findByText('Ada One');
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    const dest = screen.getByTestId('bulk-destination');
    expect(within(dest).getByRole('button', { name: /Add \d+ people/ })).toBeDisabled();
    fireEvent.click(within(dest).getByLabelText('A new assembly'));
    fireEvent.change(within(dest).getByLabelText('Name of the new assembly'), { target: { value: 'Brand New' } });
    fireEvent.click(within(dest).getByLabelText(/Also take them out of Generation 1/));
    await waitFor(() => expect(within(dest).getByRole('button', { name: 'Add 2 people' })).toBeEnabled());
    fireEvent.click(within(dest).getByRole('button', { name: 'Add 2 people' }));
    expect(await screen.findByTestId('bulk-result')).toHaveTextContent('2 memberships ended');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ personIds: ['a', 'b'], newAssembly: { name: 'Brand New' }, removeFromSource: 'gen:1' });
  });

  it('offers people with no assembly yet, and says clearly when there is no Headquarters', async () => {
    mockFetch({
      [`GET ${B}/generations`]: () => ({ body: { hasHeadquarters: false, generations: [], noAssembly: 3 } }),
      [`GET ${B}/people`]: () => ({ body: { items: people, total: 2, page: 1, pageSize: 50 } }),
    });
    render(<BulkMembersPanel base={B} />);
    expect(await screen.findByText(/No Headquarters has been set yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /No assembly yet · 3 people/ }));
    await screen.findByText('Ada One');
    expect(calls.some((c) => c.url.includes('source=none'))).toBe(true);
  });
});
