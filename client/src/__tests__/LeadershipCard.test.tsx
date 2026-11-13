import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LeadershipCard } from '../components/member/LeadershipCard';
import { MyLeadershipDashboardPage } from '../pages/MyLeadershipDashboardPage';

let leaderRole: string | null = null;
let isCentralAdmin = false;

vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({ user: leaderRole ? { role: leaderRole } : null, loading: false }),
}));
vi.mock('../lib/MemberAuthContext', () => ({
  useMemberAuth: () => ({ member: { personId: 'p1', name: 'Test', isCentralAdmin } }),
}));
vi.mock('../components/leader/LeadershipDashboardBody', () => ({ LeadershipDashboardBody: () => <p>Leader tools here</p> }));
vi.mock('../components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('../components/member/MemberNav', () => ({ MemberNav: () => null }));
vi.mock('../components/PageShell', () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

afterEach(() => {
  vi.unstubAllGlobals();
  leaderRole = null;
  isCentralAdmin = false;
});

function mockSchool(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }),
    ),
  );
}

describe('Leadership card on the Chats page', () => {
  it('is shown to an ordinary member with a locked hint, linking to the dashboard page', () => {
    render(<MemoryRouter><LeadershipCard /></MemoryRouter>);
    const card = screen.getByTestId('leadership-card');
    expect(card).toHaveAttribute('href', '/member/leadership-dashboard');
    expect(screen.getByText('Tap to see how to become a leader')).toBeInTheDocument();
    expect(screen.getByText('🔒')).toBeInTheDocument();
  });

  it('shows leaders their tools hint, without the lock', () => {
    leaderRole = 'LEADER';
    render(<MemoryRouter><LeadershipCard /></MemoryRouter>);
    expect(screen.getByText('Your people, teachings, reports and tools')).toBeInTheDocument();
    expect(screen.queryByText('🔒')).toBeNull();
  });

  it('sends the central admin to their own profile tools', () => {
    isCentralAdmin = true;
    render(<MemoryRouter><LeadershipCard /></MemoryRouter>);
    expect(screen.getByTestId('leadership-card')).toHaveAttribute('href', '/member/me');
  });
});

describe('My Leadership Dashboard page', () => {
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={['/member/leadership-dashboard']}>
        <Routes>
          <Route path="/member/leadership-dashboard" element={<MyLeadershipDashboardPage />} />
          <Route path="/member/me" element={<p>Profile page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows a non-leader the road to leadership instead of the tools', async () => {
    mockSchool({ enrollment: 'ACTIVE', books: [{ id: 'b1', trainingOrder: 1, titleEn: 'One', exam: { passed: true } }, { id: 'b2', trainingOrder: 2, titleEn: 'Two' }] });
    renderPage();
    expect(await screen.findByText('You are not yet a leader')).toBeInTheDocument();
    expect(screen.queryByText('Leader tools here')).toBeNull();
    expect(await screen.findByText('1 of 2 books passed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue my studies' })).toHaveAttribute('href', '/member/school');
  });

  it('invites someone who has not begun to start the school', async () => {
    mockSchool({ enrollment: 'NONE', books: [] });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Start the Leadership Academy' })).toHaveAttribute('href', '/member/school');
  });

  it('opens the real dashboard for a leader', async () => {
    leaderRole = 'LEADER';
    renderPage();
    expect(await screen.findByText('Leader tools here')).toBeInTheDocument();
  });

  it('sends the central admin to their profile', async () => {
    isCentralAdmin = true;
    renderPage();
    expect(await screen.findByText('Profile page')).toBeInTheDocument();
  });
});
