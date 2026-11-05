import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeadershipDashboardBody } from '../components/leader/LeadershipDashboardBody';
import { AuthProvider } from '../lib/AuthContext';

// The leader dashboard opens on a home: who you are and what you lead, what needs you today, and one card for
// each job. A card opens that job on its own, with a plain explanation and a way back.
function mockFetch(people: { total: number; needingAttention: number }, assemblies: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
      if (url.startsWith('/api/auth/me')) return json({ user: { id: 'u1', name: 'Grace Etabu', email: 'g@x.org', role: 'LEADER', mustChangePassword: false, personId: 'p1' } });
      if (url.startsWith('/api/leader/my-people')) return json({ away: null, contactTarget: 2, items: [], ...people });
      if (url.startsWith('/api/leader/role-assignments')) return json({ items: assemblies.map((name) => ({ id: name, community: { id: name, name } })) });
      if (url.startsWith('/api/leader/dashboard')) return json({ referralCode: 'GRACE1', stats: { conversionRate: 40 } });
      if (url.startsWith('/api/leader/links')) return json({ referralCode: 'GRACE1', links: { en: 'https://x.org/join?ref=GRACE1', fr: 'https://x.org/fr?ref=GRACE1' } });
      if (url.startsWith('/api/leader/referrals')) return json({ items: [], pagination: { totalPages: 1 } });
      if (url.startsWith('/api/settings/public')) return json({ content: {} });
      return json({ items: [], viewer: { canPost: false, canModerate: false, personId: null }, nextBefore: null });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const renderHome = (path = '/member/leadership-dashboard') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <LeadershipDashboardBody />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('The leader home', () => {
  it('greets the leader, names the assemblies they lead, and says who needs a message', async () => {
    mockFetch({ total: 12, needingAttention: 3 }, ['Headquarter Assembly']);
    renderHome();
    expect(await screen.findByText('Welcome, Grace')).toBeInTheDocument();
    expect(await screen.findByTestId('leader-assemblies')).toHaveTextContent('You lead: Headquarter Assembly');
    expect(await screen.findByTestId('leader-attention')).toHaveTextContent('3 of your people need a message');
  });

  it('has a card for each job, each explaining what it is for', async () => {
    mockFetch({ total: 5, needingAttention: 0 }, []);
    renderHome();
    const tiles = await screen.findByTestId('leader-tiles');
    for (const title of ['My people', 'Messages', 'My assembly', 'News and posts', 'Prayer requests', 'Results and learning', 'Invite people', 'Leaders together', 'Reports', 'Resources']) {
      expect(tiles).toHaveTextContent(title);
    }
    expect(tiles).toHaveTextContent('Write privately to members of your assembly.');
    expect(await screen.findByTestId('leader-attention')).toHaveTextContent('Everyone you look after has been contacted');
  });

  it('opens a job on its own with its explanation, and goes back to the home', async () => {
    mockFetch({ total: 5, needingAttention: 0 }, []);
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: /Invite people/ }));
    const section = await screen.findByTestId('leader-section-invite');
    expect(section).toHaveTextContent('Share your own link so people join through you');
    expect(await screen.findByText('GRACE1')).toBeInTheDocument(); // the referral code
    fireEvent.click(screen.getByRole('button', { name: /Leadership home/ }));
    await waitFor(() => expect(screen.getByTestId('leader-home')).toBeInTheDocument());
  });

  it('the attention card opens "My people"', async () => {
    mockFetch({ total: 12, needingAttention: 3 }, ['Buea']);
    renderHome();
    fireEvent.click(await screen.findByTestId('leader-attention'));
    expect(await screen.findByTestId('leader-section-people')).toBeInTheDocument();
  });

  it('can be opened straight on a job from a link', async () => {
    mockFetch({ total: 0, needingAttention: 0 }, []);
    renderHome('/member/leadership-dashboard?section=prayer');
    expect(await screen.findByTestId('leader-section-prayer')).toHaveTextContent('Prayer requests');
  });
});
