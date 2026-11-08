import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RepresentativesPanel } from '../components/admin/RepresentativesPanel';
import { InstructionsPanel } from '../components/admin/InstructionsPanel';

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
  vi.restoreAllMocks();
  calls.length = 0;
});

const R = '/api/member/central-representatives';

describe('RepresentativesPanel', () => {
  it('shows each generation, appoints a leader to one without a representative, and removes one', async () => {
    let appointed = false;
    mockFetch({
      [`GET ${R}/overview`]: () => ({
        body: {
          generations: [
            { generation: 1, assemblies: 2, representative: { id: 'r1', personId: 'p1', name: 'Rita Rep', appointedAt: '2026-11-01T00:00:00Z' } },
            { generation: 2, assemblies: 1, representative: appointed ? { id: 'r2', personId: 'p2', name: 'Leo Leader', appointedAt: '2026-11-08T00:00:00Z' } : null },
          ],
        },
      }),
      [`GET ${R}/leaders`]: () => ({ body: { items: [{ id: 'p2', name: 'Leo Leader', generations: [2], assemblies: ['Beta'] }] } }),
      [`POST ${R}/appoint`]: () => {
        appointed = true;
        return { status: 201, body: { id: 'r2' } };
      },
      [`POST ${R}/r1/remove`]: () => ({ body: { ok: true } }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RepresentativesPanel base={R} />);

    const g1 = await screen.findByTestId('rep-gen-1');
    expect(within(g1).getByText('Rita Rep')).toBeInTheDocument();
    expect(within(g1).queryByRole('button', { name: /Choose a representative/ })).toBeNull();
    const g2 = screen.getByTestId('rep-gen-2');
    expect(within(g2).getByText('No representative yet.')).toBeInTheDocument();

    fireEvent.click(within(g2).getByRole('button', { name: /Choose a representative/ }));
    fireEvent.click(await within(g2).findByRole('button', { name: 'Appoint' }));
    await waitFor(() => expect(calls.find((c) => c.url === `${R}/appoint`)?.body).toEqual({ personId: 'p2', generation: 2 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Leo Leader is now the representative.');

    fireEvent.click(within(screen.getByTestId('rep-gen-1')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${R}/r1/remove`)).toBe(true));
  });

  it('says clearly when there are no generations yet', async () => {
    mockFetch({ [`GET ${R}/overview`]: () => ({ body: { generations: [] } }) });
    render(<RepresentativesPanel base={R} />);
    expect(await screen.findByText(/There are no generations yet/)).toBeInTheDocument();
  });
});

describe('InstructionsPanel for a representative', () => {
  it('offers only their own generation or hand-picked leaders — never all leaders', async () => {
    const base = '/api/member/rep-instructions';
    mockFetch({
      [`GET ${base}/leaders`]: () => ({ body: { leaders: [{ personId: 'p1', name: 'Leader One', generations: [1], assemblies: ['Alpha'] }], generations: [1] } }),
      [`GET ${base}/`]: () => ({ body: { items: [] } }),
      [`POST ${base}/`]: () => ({ status: 201, body: { id: 'i1', recipients: 1 } }),
    });
    render(<InstructionsPanel base={base} representative />);
    fireEvent.click(await screen.findByTestId('instruction-new'));
    expect(screen.queryByLabelText('Every leader')).toBeNull();
    expect(screen.queryByLabelText('The leaders of chosen generations')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Generation 1' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('instruction-count')).toHaveTextContent('It will go to 1 leader(s).'));
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Visit people' } });
    fireEvent.change(screen.getByLabelText(/The instruction/), { target: { value: 'Please visit them.' } });
    fireEvent.click(screen.getByTestId('instruction-send'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ audience: 'GENERATIONS', generations: [1], personIds: [] }));
  });
});
