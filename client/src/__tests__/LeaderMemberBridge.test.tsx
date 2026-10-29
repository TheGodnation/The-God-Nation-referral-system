import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LeaderDashboardPage } from '../pages/LeaderDashboardPage';
import { AuthProvider } from '../lib/AuthContext';

// The Leader <-> Member identity bridge card on the Leader Dashboard: a
// one-time self-serve action (see server/src/routes/leader.ts POST
// /me/create-member-profile) that, once done (with a password now also
// required), replaces itself with a link to the Leader's own Member
// profile. `memberProfileHasPassword` on GET /api/leader/dashboard drives
// which of the three card states renders: null (not linked), false
// (linked before passwords existed there — needs POST /set-member-password),
// or true (fully set up).
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/leader/dashboard']}>
      <AuthProvider>
        <Routes>
          <Route path="/leader/dashboard" element={<LeaderDashboardPage />} />
          <Route path="/member/me" element={<div>Member Me page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const AUTH_MOCKS = {
  '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER', personId: null } } },
  '/api/leader/referrals': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
  '/api/leader/links': { status: 200, body: { referralCode: null, links: null, outreachLinks: null } },
};

describe('LeaderDashboardPage — Leader <-> Member identity bridge', () => {
  it('shows the create-profile card when not linked (asking for a password too), and switches to the fully-linked state on success', async () => {
    let memberProfileHasPassword: boolean | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const responses: Record<string, { status: number; body: unknown }> = {
          ...AUTH_MOCKS,
          '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 }, memberProfileHasPassword } },
          '/api/leader/me/create-member-profile': { status: 201, body: { personId: 'p1', personName: 'Mary Ngu' } },
        };
        if (url.includes('/api/leader/me/create-member-profile')) memberProfileHasPassword = true;
        const match = Object.keys(responses)
          .sort((a, b) => b.length - a.length)
          .find((key) => url.includes(key));
        const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
        return Promise.resolve({
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          headers: { get: () => 'application/json' },
          json: async () => res.body,
        });
      }),
    );
    renderDashboard();

    expect(await screen.findByText('Create your Member profile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create my Member profile' }));
    fireEvent.change(screen.getByPlaceholderText('+237 6XX XXX XXX'), { target: { value: '+237670000001' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByText('Your Leader account is linked to your Member profile.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'View my Member profile' })).toBeInTheDocument();
  });

  it('shows the linked state directly when the account already has a Member profile with a password', async () => {
    mockFetchByUrl({
      ...AUTH_MOCKS,
      '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER', personId: 'p1' } } },
      '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 }, memberProfileHasPassword: true } },
      '/api/leader/me/open-member-profile': { status: 200, body: { ok: true } },
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderDashboard();

    expect(await screen.findByText('Your Leader account is linked to your Member profile.')).toBeInTheDocument();
    expect(screen.queryByText('Create your Member profile')).not.toBeInTheDocument();

    // Opens the member side from the dashboard session, with no second sign-in.
    fireEvent.click(screen.getByRole('button', { name: 'View my Member profile' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/member/me'));
  });

  it('shows an error message when the server rejects the request', async () => {
    mockFetchByUrl({
      ...AUTH_MOCKS,
      '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 }, memberProfileHasPassword: null } },
      '/api/leader/me/create-member-profile': { status: 409, body: { error: 'This WhatsApp number already belongs to a different member account. Please contact an Admin for help.' } },
    });
    renderDashboard();

    await screen.findByText('Create your Member profile');
    fireEvent.click(screen.getByRole('button', { name: 'Create my Member profile' }));
    fireEvent.change(screen.getByPlaceholderText('+237 6XX XXX XXX'), { target: { value: '+237670000002' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('This WhatsApp number already belongs to a different member account. Please contact an Admin for help.')).toBeInTheDocument();
  });

  it('requires a password of at least 8 characters before submitting', async () => {
    mockFetchByUrl({
      ...AUTH_MOCKS,
      '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 }, memberProfileHasPassword: null } },
    });
    renderDashboard();

    await screen.findByText('Create your Member profile');
    fireEvent.click(screen.getByRole('button', { name: 'Create my Member profile' }));
    fireEvent.change(screen.getByPlaceholderText('+237 6XX XXX XXX'), { target: { value: '+237670000003' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Please choose a password with at least 8 characters.')).toBeInTheDocument();
  });

  it('offers to set a password for a legacy-linked profile that has none, then shows the fully-linked state once set', async () => {
    let memberProfileHasPassword: boolean | null = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const responses: Record<string, { status: number; body: unknown }> = {
          ...AUTH_MOCKS,
          '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER', personId: 'p1' } } },
          '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 }, memberProfileHasPassword } },
          '/api/leader/me/set-member-password': { status: 200, body: { ok: true } },
        };
        if (url.includes('/api/leader/me/set-member-password')) memberProfileHasPassword = true;
        const match = Object.keys(responses)
          .sort((a, b) => b.length - a.length)
          .find((key) => url.includes(key));
        const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
        return Promise.resolve({
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          headers: { get: () => 'application/json' },
          json: async () => res.body,
        });
      }),
    );
    renderDashboard();

    expect(await screen.findByText('Set a password for your Member profile')).toBeInTheDocument();
    expect(screen.queryByText('Your Leader account is linked to your Member profile.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(screen.getByText('Your Leader account is linked to your Member profile.')).toBeInTheDocument());
    expect(screen.queryByText('Set a password for your Member profile')).not.toBeInTheDocument();
  });
});
