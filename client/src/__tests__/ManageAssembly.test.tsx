import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ManageAssembly } from '../components/assembly/ManageAssembly';

// The central admin's profile adds people to an assembly and makes a private
// sub-assembly, from the assembly's info page.
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
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

function renderIt(onMembersChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <ManageAssembly communityId="c1" communityName="HQ" onMembersChanged={onMembersChanged} />
    </MemoryRouter>,
  );
  return onMembersChanged;
}

describe('Manage this assembly (central admin profile)', () => {
  it('searches people, adds one, and refreshes the members list', async () => {
    mockFetch({
      'GET /api/communities/c1/people-search': () => ({ body: { items: [{ id: 'p1', name: 'Grace Doe', photoUrl: null, isMember: false }, { id: 'p2', name: 'Grace Already', photoUrl: null, isMember: true }] } }),
      'POST /api/communities/c1/members': () => ({ status: 201, body: { ok: true } }),
    });
    const changed = renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Add people/ }));
    fireEvent.change(screen.getByLabelText('Search for a person…'), { target: { value: 'Grace' } });

    await screen.findByText('Grace Doe', undefined, { timeout: 3000 });
    const list = screen.getByTestId('people-results');
    const rows = within(list).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('Already in');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Add' }));
    expect(await within(list).findByText('✓ Added')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ personId: 'p1' });
    expect(changed).toHaveBeenCalled();
  });

  it('makes a private sub-assembly and offers to open it', async () => {
    mockFetch({ 'POST /api/communities/c1/sub-assemblies': () => ({ status: 201, body: { id: 'c2', name: 'HQ Leaders' } }) });
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /New sub-assembly/ }));
    expect(screen.getByText(/A private assembly inside HQ/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name of the sub-assembly'), { target: { value: 'HQ Leaders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('✓ HQ Leaders is ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/member/chats/group/c2/info');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'HQ Leaders' });
  });
});
