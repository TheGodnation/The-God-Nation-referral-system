import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MergeAccountsCard } from '../components/admin/MergeAccountsCard';

// One person with two accounts: choose the one he really uses, choose the duplicate, see what would move, then merge.
const calls: { url: string; method: string; body: any }[] = [];
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
  vi.restoreAllMocks();
  calls.length = 0;
});

const described = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  whatsappNumber: '+237 600 000 001',
  signInEmail: `${id}@x.org`,
  leaderSignIn: false,
  leaderOf: [],
  assemblies: 1,
  peopleHeFollows: 0,
  leadersFollowingHim: 0,
  messages: 0,
  ...over,
});

const report = {
  summary: { roles: 1, peopleHeFollows: 12, leadersFollowingHim: 1, memberships: 2, messages: 140, posts: 3, learning: 0, other: 55, dropped: 2, betweenThem: 1 },
  droppedSignInEmail: 'old@x.org',
  signInEmail: 'new@x.org',
  duplicate: { name: 'Old Account', whatsappNumber: '+237 600 000 002' },
};

async function search(index: 0 | 1, query: string) {
  const input = screen.getAllByPlaceholderText('Name or WhatsApp number')[index];
  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(index + 1));
}

describe('MergeAccountsCard', () => {
  it('shows what would move for the person (role, people, followers, assemblies, chats) and merges only after confirming', async () => {
    mockFetch({
      '/api/admin/cells/people': () => ({ status: 200, body: { items: [{ id: 'p-keep', name: 'Anna New', whatsappNumber: '+237 600 000 001' }, { id: 'p-dup', name: 'Anna Old', whatsappNumber: '+237 600 000 002' }] } }),
      '/api/admin/cells/merge-people/describe?personId=p-keep': () => ({ status: 200, body: described('p-keep', 'Anna New') }),
      '/api/admin/cells/merge-people/describe?personId=p-dup': () => ({ status: 200, body: described('p-dup', 'Anna Old', { leaderSignIn: true, leaderOf: ['Headquarters'], peopleHeFollows: 12, messages: 140 }) }),
      '/api/admin/cells/merge-people': (init) => ({ status: 200, body: { dryRun: JSON.parse(String(init?.body)).dryRun, report } }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MergeAccountsCard base="/api/admin/cells" />);
    // Nothing can be previewed until both accounts are chosen.
    expect(screen.getByTestId('merge-preview')).toBeDisabled();

    // The account he really uses (stays), then the duplicate.
    await search(0, 'Anna');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p-keep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this one' }));
    expect(await screen.findByTestId('merge-card-p-keep')).toBeInTheDocument();
    await search(1, 'Anna');
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'p-dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'This is the duplicate' }));
    const dupCard = await screen.findByTestId('merge-card-p-dup');
    expect(dupCard).toHaveTextContent('Leader of Headquarters');
    expect(dupCard).toHaveTextContent('follows 12 people');

    // Only one email opens the account afterwards: the admin chooses which (the kept account's by default).
    const choice = await screen.findByTestId('merge-email-choice');
    expect(choice).toHaveTextContent('p-keep@x.org');
    expect(choice).toHaveTextContent('p-dup@x.org');
    expect(within(choice).getAllByRole('radio')[0]).toBeChecked();
    fireEvent.click(within(choice).getAllByRole('radio')[1]);

    // The preview says what continues on the kept account and changes nothing.
    fireEvent.click(screen.getByTestId('merge-preview'));
    const out = await screen.findByTestId('merge-report');
    expect(out).toHaveTextContent('Everything of Anna Old will continue on Anna New');
    expect(out).toHaveTextContent('1 leader or team role(s)');
    expect(out).toHaveTextContent('12 people he follows up');
    expect(out).toHaveTextContent('1 leader(s) who follow him up');
    expect(out).toHaveTextContent('2 assembly or group membership(s)');
    expect(out).toHaveTextContent('140 chat message(s)');
    expect(out).toHaveTextContent('He will sign in with new@x.org');
    expect(out).toHaveTextContent('The email old@x.org will no longer open the account');
    expect(out).toHaveTextContent('This cannot be undone');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ keepPersonId: 'p-keep', mergePersonId: 'p-dup', dryRun: true, signInEmail: 'duplicate' });
    expect(confirm).not.toHaveBeenCalled();

    // Merging asks first, then does it.
    fireEvent.click(screen.getByTestId('merge-go'));
    expect(await screen.findByText(/Anna Old is now merged into Anna New/)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Merge Anna Old into Anna New?'));
    expect(calls.filter((c) => c.method === 'POST').pop()?.body).toEqual({ keepPersonId: 'p-keep', mergePersonId: 'p-dup', dryRun: false, signInEmail: 'duplicate' });
  });

  it('does not merge when the confirmation is declined, and explains a refusal from the server', async () => {
    mockFetch({
      '/api/admin/cells/people': () => ({ status: 200, body: { items: [{ id: 'p-keep', name: 'Anna New', whatsappNumber: '1' }, { id: 'p-dup', name: 'Anna Old', whatsappNumber: '2' }] } }),
      '/api/admin/cells/merge-people/describe?personId=p-keep': () => ({ status: 200, body: described('p-keep', 'Anna New') }),
      '/api/admin/cells/merge-people/describe?personId=p-dup': () => ({ status: 200, body: described('p-dup', 'Anna Old') }),
      '/api/admin/cells/merge-people': (init) => (JSON.parse(String(init?.body)).dryRun ? { status: 200, body: { dryRun: true, report } } : { status: 400, body: { error: 'The central admin account cannot be merged.' } }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MergeAccountsCard base="/api/admin/cells" />);
    await search(0, 'Anna');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p-keep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this one' }));
    await screen.findByTestId('merge-card-p-keep');
    await search(1, 'Anna');
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'p-dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'This is the duplicate' }));
    await waitFor(() => expect(screen.getByTestId('merge-preview')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('merge-preview'));
    fireEvent.click(await screen.findByTestId('merge-go'));
    // Declined: nothing was sent beyond the preview.
    expect(confirm).toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'POST' && c.body?.dryRun === false)).toHaveLength(0);
    // Confirmed, but the server refuses: its reason is shown and nothing is claimed as done.
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('merge-go'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The central admin account cannot be merged.');
    expect(screen.queryByText(/is now merged into/)).toBeNull();
  });
});
