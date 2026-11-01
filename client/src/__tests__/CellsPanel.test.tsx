import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CellsPanel } from '../components/admin/CellsPanel';

// The central admin's assemblies panel: how full each assembly is, who is
// ready to lead, one-tap appointment and the assembly size — the same panel
// for the admin dashboard and the central admin's own member profile.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetch(handlers: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      const res = key ? handlers[key](init) : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({ ok: res.status < 300, status: res.status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const overview = {
  capacity: 200,
  requiredBooks: 15,
  items: [
    { id: 'a1', name: 'Headquarters', parentId: null, parentName: null, autoCreated: false, createdAt: '2026-01-01', members: 200, leaders: 3, readyToLead: 0, unassigned: 0 },
    { id: 'a2', name: 'Headquarters · 1', parentId: 'a1', parentName: 'Headquarters', autoCreated: true, createdAt: '2026-11-01', members: 12, leaders: 2, readyToLead: 2, unassigned: 5 },
  ],
};

describe('CellsPanel', () => {
  it('shows each assembly with its size and leaders, flags the one opened automatically and the people ready to lead', async () => {
    mockFetch({ '/api/admin/cells/overview': () => ({ status: 200, body: overview }) });
    render(<CellsPanel base="/api/admin/cells" />);
    expect(await screen.findByText('Headquarters · 1')).toBeInTheDocument();
    expect(screen.getByText('200 of 200 members · 3 leaders')).toBeInTheDocument();
    expect(screen.getByText('12 of 200 members · 2 leaders')).toBeInTheDocument();
    expect(screen.getByText('Opened automatically')).toBeInTheDocument();
    expect(screen.getByText('Under Headquarters')).toBeInTheDocument();
    expect(screen.getByText('2 ready to lead')).toBeInTheDocument();
  });

  it('opens an assembly, lists who is ready to lead and appoints one with a tap', async () => {
    let appointed = false;
    mockFetch({
      '/api/member/central-cells/overview': () => ({ status: 200, body: overview }),
      '/api/member/central-cells/ready-to-lead': () => ({
        status: 200,
        body: { requiredBooks: 15, items: appointed ? [] : [{ personId: 'p1', name: 'Marie Ngono', whatsappNumber: '+237600000001', finishedAt: '2026-10-30T10:00:00.000Z' }] },
      }),
      '/api/member/central-cells/appoint': () => {
        appointed = true;
        return { status: 201, body: { id: 'r1' } };
      },
    });
    render(<CellsPanel base="/api/member/central-cells" />);
    fireEvent.click(await screen.findByText('Headquarters · 1'));
    expect(await screen.findByText('Marie Ngono')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Appoint as leader' }));
    expect(await screen.findByText('Appointed. They have been told.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/api/member/central-cells/appoint');
    expect(post?.body).toEqual({ personId: 'p1', communityId: 'a2' });
    await waitFor(() => expect(screen.getByText('Nobody is ready to lead here yet.')).toBeInTheDocument());
  });

  it('saves a new assembly size, and refuses a number that is too small', async () => {
    mockFetch({
      '/api/admin/cells/overview': () => ({ status: 200, body: overview }),
      '/api/admin/cells/capacity': () => ({ status: 200, body: { assemblyCapacity: 150 } }),
    });
    render(<CellsPanel base="/api/admin/cells" />);
    const input = await screen.findByLabelText('Members in one assembly');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number from 10 to 5000.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ assemblyCapacity: 150 });
  });

  it('shows how many people nobody follows and shares them among the leaders', async () => {
    mockFetch({
      '/api/admin/cells/overview': () => ({ status: 200, body: overview }),
      '/api/admin/cells/ready-to-lead': () => ({ status: 200, body: { requiredBooks: 15, items: [] } }),
      '/api/admin/cells/share': () => ({ status: 200, body: { assigned: 5, noLeaders: false } }),
    });
    render(<CellsPanel base="/api/admin/cells" />);
    expect(await screen.findByText('5 not followed yet')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Headquarters · 1'));
    expect(await screen.findByText('5 people in this assembly are not followed by any leader yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share them among the leaders' }));
    expect(await screen.findByText('5 people shared among the leaders, evenly.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ communityId: 'a2' });
  });

  it('shows each assembly\'s health as a coloured dot', async () => {
    mockFetch({
      '/api/admin/cells/overview': () => ({ status: 200, body: overview }),
      '/api/admin/cells/health': () => ({
        status: 200,
        body: { items: [
          { id: 'a1', own: { color: 'GREEN', weeklyRate: 0.9 }, tree: { color: 'RED' } },
          { id: 'a2', own: { color: 'RED', weeklyRate: 0.1 }, tree: { color: 'RED' } },
        ] },
      }),
    });
    render(<CellsPanel base="/api/admin/cells" />);
    expect(await screen.findByLabelText('Going well')).toBeInTheDocument();
    expect(screen.getByLabelText('Needs help')).toBeInTheDocument();
  });

  it('says so when no Leadership School exam is published yet', async () => {
    mockFetch({ '/api/admin/cells/overview': () => ({ status: 200, body: { ...overview, requiredBooks: 0 } }) });
    render(<CellsPanel base="/api/admin/cells" />);
    expect(await screen.findByText(/No Leadership School exam is published yet/)).toBeInTheDocument();
  });
});
