import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

  it('shows how many people nobody follows, lets you choose the leaders and a number each, previews, then assigns', async () => {
    mockFetch({
      '/api/admin/cells/overview': () => ({ status: 200, body: overview }),
      '/api/admin/cells/ready-to-lead': () => ({ status: 200, body: { requiredBooks: 15, items: [] } }),
      '/api/admin/cells/leaders': () => ({ status: 200, body: { items: [
        { personId: 'l1', name: 'Anna', away: false, headcount: 2 },
        { personId: 'l2', name: 'Boris', away: false, headcount: 0 },
        { personId: 'l3', name: 'Away Alice', away: true, headcount: 0 },
      ] } }),
      '/api/admin/cells/share': () => ({ status: 200, body: { assigned: 4, remaining: 1, noLeaders: false, dryRun: false, perLeader: [{ personId: 'l1', name: 'Anna', added: 2 }, { personId: 'l2', name: 'Boris', added: 2 }] } }),
    });
    render(<CellsPanel base="/api/admin/cells" />);
    expect(await screen.findByText('5 not followed yet')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Headquarters · 1'));
    expect(await screen.findByText('5 people in this assembly are not followed by any leader yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('assign-toggle'));
    const tool = await screen.findByTestId('assign-people');
    // Everyone who is present is ticked; the leader who is away is not.
    expect(within(tool).getByRole('checkbox', { name: /Anna/ })).toBeChecked();
    expect(within(tool).getByRole('checkbox', { name: /Away Alice/ })).not.toBeChecked();
    fireEvent.change(screen.getByTestId('assign-each'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('assign-preview'));
    expect(await screen.findByTestId('assign-plan')).toHaveTextContent('Anna: +2');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ communityId: 'a2', leaderPersonIds: ['l1', 'l2'], perLeader: 2, dryRun: true });
    fireEvent.click(screen.getByTestId('assign-confirm'));
    expect(await screen.findByText('4 people assigned. 1 still unassigned.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').pop()?.body).toEqual({ communityId: 'a2', leaderPersonIds: ['l1', 'l2'], perLeader: 2, dryRun: false });
  });

  it('takes back everyone a leader follows (to undo a test), after asking, and offers it only for leaders who follow people', async () => {
    let anna = 5;
    mockFetch({
      '/api/admin/cells/overview': () => ({ status: 200, body: overview }),
      '/api/admin/cells/ready-to-lead': () => ({ status: 200, body: { requiredBooks: 15, items: [] } }),
      '/api/admin/cells/leaders': () => ({ status: 200, body: { items: [
        { personId: 'l1', name: 'Anna', away: false, headcount: anna },
        { personId: 'l2', name: 'Boris', away: false, headcount: 0 },
      ] } }),
      '/api/admin/cells/release': () => { anna = 0; return { status: 200, body: { released: 5 } }; },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CellsPanel base="/api/admin/cells" />);
    fireEvent.click(await screen.findByText('Headquarters · 1'));
    fireEvent.click(await screen.findByTestId('assign-toggle'));
    await screen.findByTestId('assign-people');
    expect(screen.queryByTestId('take-back-l2')).toBeNull();
    fireEvent.click(screen.getByTestId('take-back-l1'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Take back all 5 people from Anna'));
    expect(await screen.findByText('5 people taken back from Anna. They can be assigned again.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/cells/release'))?.body).toEqual({ fromLeaderPersonId: 'l1', communityId: 'a2' });
    await waitFor(() => expect(screen.queryByTestId('take-back-l1')).toBeNull());
    confirm.mockRestore();
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
