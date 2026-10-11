import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LeaderDashboardPage } from '../pages/LeaderDashboardPage';
import { AuthProvider } from '../lib/AuthContext';

// The Leader <-> Member identity bridge card on the Leader Dashboard: a
// one-time self-serve action (see server/src/routes/leader.ts POST
// /me/create-member-profile) that, once done, replaces itself with a link
// to the Leader's own Member profile.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
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
  return () => {};
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

const BASE_MOCKS = {
  '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 } } },
  '/api/leader/referrals': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
  '/api/leader/links': { status: 200, body: { referralCode: null, links: null, outreachLinks: null } },
};

describe('LeaderDashboardPage — Leader <-> Member identity bridge', () => {
  it('shows the create-profile card when not linked, and switches to the linked state on success', async () => {
    let personId: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const responses: Record<string, { status: number; body: unknown }> = {
          ...BASE_MOCKS,
          '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER', personId } } },
          '/api/leader/me/create-member-profile': { status: 201, body: { personId: 'p1', personName: 'Mary Ngu' } },
        };
        if (url.includes('/api/leader/me/create-member-profile')) personId = 'p1';
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
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByText('Your Leader account is linked to your Member profile.')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'View my Member profile' })).toBeInTheDocument();
  });

  it('shows the linked state directly when the account already has a Member profile', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER', personId: 'p1' } } },
    });
    renderDashboard();

    expect(await screen.findByText('Your Leader account is linked to your Member profile.')).toBeInTheDocument();
    expect(screen.queryByText('Create your Member profile')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'View my Member profile' }));
    await waitFor(() => expect(screen.getByText('Member Me page')).toBeInTheDocument());
  });

  it('shows an error message when the server rejects the request', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER', personId: null } } },
      '/api/leader/me/create-member-profile': { status: 409, body: { error: 'This WhatsApp number already belongs to a different member account. Please contact an Admin for help.' } },
    });
    renderDashboard();

    await screen.findByText('Create your Member profile');
    fireEvent.click(screen.getByRole('button', { name: 'Create my Member profile' }));
    fireEvent.change(screen.getByPlaceholderText('+237 6XX XXX XXX'), { target: { value: '+237670000002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('This WhatsApp number already belongs to a different member account. Please contact an Admin for help.')).toBeInTheDocument();
  });
});
