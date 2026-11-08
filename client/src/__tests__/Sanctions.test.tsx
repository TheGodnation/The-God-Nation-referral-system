import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SanctionsPanel } from '../components/admin/SanctionsPanel';
import { MutedBanner } from '../components/chat/MutedBanner';

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

const B = '/api/member/sanctions';
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const sanction = (over: Record<string, unknown> = {}) => ({ id: 's1', personId: 'p1', personName: 'Ada Member', communityId: 'a1', assemblyName: 'Alpha', reason: 'Insults', days: 7, endsAt: future, byRole: 'LEADER', byName: 'Leo Leader', status: 'ACTIVE', excuseMessage: null, canLift: true, ...over });

describe('SanctionsPanel (a leader)', () => {
  it('mutes someone in an assembly they lead for 3, 7, 15 or 30 days, with a reason', async () => {
    mockFetch({
      [`GET ${B}/overview`]: () => ({ body: { durations: [3, 7, 15, 30], isCentralAdmin: false, sanctions: [], removalRequests: [] } }),
      [`GET ${B}/assemblies`]: () => ({ body: { items: [{ id: 'a1', name: 'Alpha' }] } }),
      [`GET ${B}/members`]: () => ({ body: { items: [{ id: 'p1', name: 'Ada Member', whatsappNumber: '+2371' }] } }),
      [`POST ${B}/mute`]: () => ({ status: 201, body: { id: 's9' } }),
    });
    render(<SanctionsPanel base={B} />);
    fireEvent.change(await screen.findByLabelText('Choose the assembly'), { target: { value: 'a1' } });
    fireEvent.change(await screen.findByLabelText('Choose the person'), { target: { value: 'p1' } });
    expect(['3 days', '7 days', '15 days', '30 days'].every((l) => screen.queryByRole('button', { name: l }))).toBe(true);
    expect(screen.queryByRole('button', { name: '1 days' })).toBeNull();
    const muteBtn = screen.getByRole('button', { name: /^🔇 Mute$/ });
    expect(muteBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '15 days' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Posting unrelated links' } });
    await waitFor(() => expect(muteBtn).toBeEnabled());
    fireEvent.click(muteBtn);
    expect(await screen.findByRole('status')).toHaveTextContent('Muted. They have been told.');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ communityId: 'a1', personId: 'p1', days: 15, reason: 'Posting unrelated links' });
  });

  it('offers a removal request, never a direct removal, and cannot decide requests', async () => {
    mockFetch({
      [`GET ${B}/overview`]: () => ({ body: { durations: [3, 7, 15, 30], isCentralAdmin: false, sanctions: [], removalRequests: [{ id: 'r1', personName: 'Bob', assemblyName: 'Alpha', reason: 'Keeps insulting', requestedByName: 'Leo', status: 'PENDING', decisionNote: null }] } }),
      [`GET ${B}/assemblies`]: () => ({ body: { items: [{ id: 'a1', name: 'Alpha' }] } }),
      [`GET ${B}/members`]: () => ({ body: { items: [{ id: 'p1', name: 'Ada Member', whatsappNumber: null }] } }),
    });
    render(<SanctionsPanel base={B} />);
    fireEvent.change(await screen.findByLabelText('Choose the assembly'), { target: { value: 'a1' } });
    fireEvent.change(await screen.findByLabelText('Choose the person'), { target: { value: 'p1' } });
    expect(screen.getByRole('button', { name: 'Ask the central admin to remove this person' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from the assembly now' })).toBeNull();
    const row = await screen.findByTestId('removal-row');
    expect(within(row).getByText(/Waiting/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Approve and remove' })).toBeNull();
  });

  it('lets a leader lift their own mute but says the central admin’s cannot be lifted', async () => {
    mockFetch({
      [`GET ${B}/overview`]: () => ({ body: { durations: [3, 7, 15, 30], isCentralAdmin: false, removalRequests: [], sanctions: [sanction({ excuseMessage: 'I am sorry' }), sanction({ id: 's2', personName: 'Cy', byRole: 'ADMIN', byName: '', canLift: false })] } }),
      [`GET ${B}/assemblies`]: () => ({ body: { items: [] } }),
      [`POST ${B}/s1/lift`]: () => ({ body: { ok: true } }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SanctionsPanel base={B} />);
    const rows = await screen.findAllByTestId('sanction-row');
    expect(within(rows[0]).getByText(/I am sorry/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Leo Leader/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Only the central admin can lift this one.')).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: 'Lift the mute' })).toBeNull();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Lift the mute' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${B}/s1/lift`)).toBe(true));
  });
});

describe('SanctionsPanel (the central admin)', () => {
  it('can approve a removal request and remove directly', async () => {
    mockFetch({
      [`GET ${B}/overview`]: () => ({ body: { durations: [3, 7, 15, 30], isCentralAdmin: true, sanctions: [], removalRequests: [{ id: 'r1', personName: 'Bob', assemblyName: 'Alpha', reason: 'Keeps insulting', requestedByName: 'Leo', status: 'PENDING', decisionNote: null }] } }),
      [`GET ${B}/assemblies`]: () => ({ body: { items: [] } }),
      [`POST ${B}/removal-requests/r1/decide`]: () => ({ body: { approved: true } }),
    });
    render(<SanctionsPanel base={B} />);
    const row = await screen.findByTestId('removal-row');
    fireEvent.change(within(row).getByPlaceholderText('A note (optional)'), { target: { value: 'Agreed' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Approve and remove' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/decide'))?.body).toEqual({ approve: true, note: 'Agreed' }));
  });
});

describe('MutedBanner (the muted person)', () => {
  it('shows why and until when, and lets them ask for excuse once', async () => {
    mockFetch({ [`POST ${B}/s1/excuse`]: () => ({ body: { ok: true } }) });
    const onChanged = vi.fn();
    render(<MutedBanner mute={{ id: 's1', reason: 'Insults', endsAt: future, excuseSent: false }} onChanged={onChanged} />);
    expect(screen.getByText(/You are muted in this assembly until/)).toBeInTheDocument();
    expect(screen.getByText(/Reason: Insults/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for excuse' }));
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Write a few words to ask for excuse'), { target: { value: 'I am sorry, forgive me.' } });
    fireEvent.click(send);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ message: 'I am sorry, forgive me.' });
  });

  it('says it was already sent', () => {
    render(<MutedBanner mute={{ id: 's1', reason: 'x y z', endsAt: future, excuseSent: true }} onChanged={() => {}} />);
    expect(screen.getByText(/Your request for excuse was sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for excuse' })).toBeNull();
  });
});
