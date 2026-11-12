import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AccountDeletionsTab } from '../components/admin/AccountDeletionsTab';
import { DeleteChoice } from '../components/admin/DeleteChoice';
import i18n from '../i18n';

// The central admin's three ways to delete: free to return, only with approval, never;
// and the "Kept out" list with who tried to come back.
const calls: { url: string; method: string; body: any }[] = [];

let kept: any[];
let open: any[];
function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      let out: unknown = { ok: true };
      if (method === 'GET' && url.endsWith('/kept-out')) out = { items: kept };
      else if (method === 'GET') out = { items: open, closed: [] };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => out });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

const READY_ROW = { id: 'r2', name: 'Paul', email: 'p@x.com', whatsappNumber: '+237670000002', source: 'WEB', requestedAt: '2026-09-01T10:00:00Z', readyAt: '2026-10-01T10:00:00Z', ready: true, returnedRoles: [] };

describe('Delete choice', () => {
  it('offers the three ways and asks for a note only for the two that keep the number out', () => {
    const modes: string[] = [];
    const { rerender } = render(<DeleteChoice mode="FREE" note="" onMode={(m) => modes.push(m)} onNote={() => {}} name="Paul" />);
    expect(screen.getByText('Delete — free to return')).toBeInTheDocument();
    expect(screen.getByText('Delete — return only with my approval')).toBeInTheDocument();
    expect(screen.getByText('Delete — never allowed back')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-note')).toBeNull();
    fireEvent.click(screen.getByTestId('delete-mode-NEVER'));
    expect(modes).toEqual(['NEVER']);
    rerender(<DeleteChoice mode="NEVER" note="" onMode={() => {}} onNote={() => {}} name="Paul" />);
    expect(screen.getByTestId('delete-note')).toBeInTheDocument();
    expect(screen.getByText(/Only the number, the email, the name and this note are kept/)).toBeInTheDocument();
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    render(<DeleteChoice mode="FREE" note="" onMode={() => {}} onNote={() => {}} name="Paul" />);
    expect(screen.getByText('Supprimer — jamais de retour')).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});

describe('Account deletions: how to delete, and who is kept out', () => {
  it('asks how before deleting, and sends the choice and the note', async () => {
    kept = [];
    open = [READY_ROW];
    mockFetch();
    render(<AccountDeletionsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete for good' }));
    // Nothing is sent yet: the choice comes first.
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByTestId('delete-mode-NEVER'));
    fireEvent.change(screen.getByTestId('delete-note'), { target: { value: 'Took money' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'DELETE', mode: 'NEVER', note: 'Took money' }));
  });

  it('is free to return by default, with no note sent', async () => {
    kept = [];
    open = [READY_ROW];
    mockFetch();
    render(<AccountDeletionsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete for good' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'DELETE', mode: 'FREE' }));
  });

  it('lists who is kept out, who tried to come back, and lets the admin allow or keep out for good', async () => {
    open = [];
    kept = [
      { groupId: 'g1', mode: 'APPROVAL', status: 'ACTIVE', personName: 'Joe Scam', note: 'Ask the pastor', whatsappNumbers: ['+237670000009'], emails: ['joe@x.com'], attempts: 2, lastAttemptAt: '2026-11-10T10:00:00Z', decidedAt: null },
      { groupId: 'g2', mode: 'NEVER', status: 'ACTIVE', personName: 'Bad Actor', note: null, whatsappNumbers: ['+237670000010'], emails: [], attempts: 0, lastAttemptAt: null, decidedAt: null },
      { groupId: 'g3', mode: 'APPROVAL', status: 'APPROVED', personName: 'Old Case', note: null, whatsappNumbers: ['+237670000011'], emails: [], attempts: 1, lastAttemptAt: null, decidedAt: '2026-11-01T10:00:00Z' },
    ];
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountDeletionsTab />);
    const joe = await screen.findByTestId('kept-g1');
    expect(within(joe).getByText('Return only with your approval')).toBeInTheDocument();
    expect(within(joe).getByText(/Tried to come back 2 time/)).toBeInTheDocument();
    expect(within(joe).getByText(/Your note: Ask the pastor/)).toBeInTheDocument();
    expect(within(joe).getByText('+237670000009 · joe@x.com')).toBeInTheDocument();
    const bad = screen.getByTestId('kept-g2');
    expect(within(bad).getByText('Never allowed back')).toBeInTheDocument();
    expect(within(bad).getByText('No attempt yet')).toBeInTheDocument();
    // "Never" can only be lifted; "approval" can be allowed or made permanent.
    expect(within(bad).getByRole('button', { name: 'Lift the block' })).toBeInTheDocument();
    expect(within(bad).queryByRole('button', { name: 'Keep out for good' })).toBeNull();
    expect(within(screen.getByTestId('kept-g3')).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId('kept-g3')).getByText(/You allowed them back on/)).toBeInTheDocument();

    fireEvent.click(within(joe).getByRole('button', { name: 'Allow them to register' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.url).toContain('/kept-out/g1/allow'));
    calls.length = 0;
    fireEvent.click(within(joe).getByRole('button', { name: 'Keep out for good' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.url).toContain('/kept-out/g1/never'));
  });
});
