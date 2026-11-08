import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MakeLeadersPanel } from '../components/admin/MakeLeadersPanel';

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

const B = '/api/member/central-cells';

describe('MakeLeadersPanel', () => {
  it('brings the leaders of another group (the Leadership Team) to this assembly in one step and says what happened', async () => {
    mockFetch({
      'GET /api/member/central-communities': () => ({ body: { items: [{ id: 'team', name: 'Leadership Team' }] } }),
      [`GET ${B}/leaders-of`]: () => ({ body: { items: [{ id: 'l1', name: 'Ada Leader' }, { id: 'l2', name: 'Ben Leader' }] } }),
      [`POST ${B}/make-leaders`]: () => ({
        status: 201,
        body: { results: [
          { personId: 'l1', name: 'Ada Leader', status: 'APPOINTED', addedToAssembly: true, leaderAccount: 'CREATED' },
          { personId: 'l2', name: 'Ben Leader', status: 'APPOINTED', addedToAssembly: false, leaderAccount: 'NO_MEMBER_ACCOUNT' },
        ] },
      }),
    });
    render(<MakeLeadersPanel base={B} communityId="hq" communityName="Headquarters Assembly" />);
    fireEvent.change(screen.getByPlaceholderText(/Search a group or assembly by name/), { target: { value: 'Leader' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]);
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    const list = await screen.findByTestId('from-leaders');
    expect(within(list).getByText('Leaders of Leadership Team')).toBeInTheDocument();
    expect(calls.some((c) => c.url === `${B}/leaders-of?communityId=team`)).toBe(true);
    // Everyone is ticked; untick nobody and send.
    fireEvent.click(within(list).getByRole('button', { name: 'Make 2 leaders of Headquarters Assembly' }));
    const results = await screen.findByTestId('make-results');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ communityId: 'hq', personIds: ['l1', 'l2'] });
    expect(results).toHaveTextContent('Ada Leader is now a leader. They were added to the assembly. Their leadership dashboard is ready.');
    expect(results).toHaveTextContent('Ben Leader is now a leader. They have not joined the app as a member yet');
  });

  it('finds a person by name, flags who has not joined the app, and makes them a leader', async () => {
    mockFetch({
      [`GET ${B}/people`]: () => ({ body: { items: [{ id: 'p1', name: 'Paul Joined', whatsappNumber: '+2371', hasMemberAccount: true }, { id: 'p2', name: 'Pia Absent', whatsappNumber: '+2372', hasMemberAccount: false }] } }),
      [`POST ${B}/make-leaders`]: () => ({ status: 201, body: { results: [{ personId: 'p1', name: 'Paul Joined', status: 'ALREADY_LEADER', addedToAssembly: false, leaderAccount: 'ALREADY' }] } }),
    });
    render(<MakeLeadersPanel base={B} communityId="hq" communityName="HQ" />);
    fireEvent.change(screen.getByPlaceholderText('Name or WhatsApp number'), { target: { value: 'P' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[1]);
    expect(await screen.findByText('Pia Absent')).toBeInTheDocument();
    expect(screen.getByText('has not joined the app')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Make leader' })[0]);
    expect(await screen.findByTestId('make-results')).toHaveTextContent('Paul Joined already leads here.');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ communityId: 'hq', personIds: ['p1'] });
  });

  it('explains what to do when the person is not found (they have not joined the app yet)', async () => {
    mockFetch({ 'GET /api/admin/cells/people': () => ({ body: { items: [] } }) });
    render(<MakeLeadersPanel base="/api/admin/cells" communityId="hq" communityName="HQ" />);
    fireEvent.change(screen.getByPlaceholderText('Name or WhatsApp number'), { target: { value: 'Nobody' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[1]);
    expect(await screen.findByTestId('not-found-hint')).toHaveTextContent('have not joined the app yet');
  });
});
