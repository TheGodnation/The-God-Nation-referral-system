import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DuplicateSuspectsCard } from '../components/admin/DuplicateSuspectsCard';
import { MergeAccountsCard } from '../components/admin/MergeAccountsCard';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
const A = { id: 'a1', name: 'Stanley Ndoh', photoUrl: null, whatsappNumber: '+237670000001', signInEmail: 'stan.ndoh@gmail.com', joinedAt: '2026-01-01T10:00:00Z', hasAccount: true };
const B = { id: 'b1', name: 'Ndoh Stanley', photoUrl: null, whatsappNumber: '+237670000002', signInEmail: 'stanndoh@gmail.com', joinedAt: '2026-11-01T10:00:00Z', hasAccount: true };
const described = (p: typeof A) => ({ id: p.id, name: p.name, whatsappNumber: p.whatsappNumber, signInEmail: p.signInEmail, leaderSignIn: false, leaderOf: [], assemblies: 1, peopleHeFollows: 0, leadersFollowingHim: 0, messages: 0 });
afterEach(() => vi.unstubAllGlobals());

function open(el: HTMLElement) {
  const d = el as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
}

describe('Possible duplicates card', () => {
  it('lists a pair with the reasons, "Merge" hands both accounts to the merge tool, and "Not the same person" hides it', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return json({ ok: true }); }
      return json({ items: [{ a: A, b: B, signs: ['email', 'name'] }] });
    }));
    const onMerge = vi.fn();
    render(<DuplicateSuspectsCard base="/api/admin/cells" onMerge={onMerge} />);
    open(screen.getByTestId('duplicate-suspects'));
    const row = await screen.findByTestId('suspect-a1-b1');
    expect(row).toHaveTextContent('Same inbox');
    expect(row).toHaveTextContent('Same name');
    fireEvent.click(screen.getByTestId('suspect-merge-a1-b1'));
    expect(onMerge).toHaveBeenCalledWith('a1', 'b1');
    fireEvent.click(screen.getByTestId('suspect-no-a1-b1'));
    await waitFor(() => expect(screen.queryByTestId('suspect-a1-b1')).toBeNull());
    expect(posts).toEqual([{ personAId: 'a1', personBId: 'b1' }]);
  });

  it('says so when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [] })));
    render(<DuplicateSuspectsCard base="/api/admin/cells" onMerge={() => {}} />);
    open(screen.getByTestId('duplicate-suspects'));
    expect(await screen.findByTestId('duplicates-none')).toBeInTheDocument();
  });
});

describe('Merge tool opened from the list', () => {
  it('opens with both accounts chosen (older kept) and "Swap" turns them round', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => json(described(url.includes('a1') ? A : B))));
    render(<MergeAccountsCard base="/api/admin/cells" prefill={{ keepId: 'a1', dupId: 'b1', nonce: 1 }} />);
    await screen.findByTestId('merge-card-a1');
    expect(screen.getByTestId('merge-card-b1')).toBeInTheDocument();
    expect((screen.getByTestId('merge-accounts') as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(screen.getByTestId('merge-swap'));
    // After the swap the first card shown is the other account.
    const cards = screen.getAllByTestId(/merge-card-/);
    expect(cards[0]).toHaveAttribute('data-testid', 'merge-card-b1');
  });
});
