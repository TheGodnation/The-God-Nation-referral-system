import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeaderDashboardPage } from '../pages/LeaderDashboardPage';
import { AuthProvider } from '../lib/AuthContext';

// Fixes a gap where the server already computed a Leader's outreach
// (/welcome) links but the dashboard never fetched or rendered them —
// leaders had no way to get a link suitable for cold audiences (e.g. a
// Facebook post) that lands on /welcome instead of /join. Same
// URL-dispatching fetch mock pattern used across the rest of this suite.
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
    <MemoryRouter>
      <AuthProvider>
        <LeaderDashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const BASE_MOCKS = {
  '/api/auth/me': { status: 200, body: { user: { id: 'u1', name: 'Mary Ngu', email: 'mary@example.com', role: 'LEADER' } } },
  '/api/leader/dashboard': { status: 200, body: { referralCode: 'MARY123', stats: { whatsappClicks: 0, conversionRate: 0 } } },
  '/api/leader/referrals': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
};

describe('LeaderDashboardPage — outreach (Facebook-friendly) link', () => {
  it('shows the Outreach Message Links card with the /welcome links when a referral code is active', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/links': {
        status: 200,
        body: {
          referralCode: 'MARY123',
          links: { en: 'https://thegodnationacademy.org/join?ref=MARY123&lang=en', fr: 'https://thegodnationacademy.org/join?ref=MARY123&lang=fr' },
          outreachLinks: { en: 'https://thegodnationacademy.org/welcome?ref=MARY123&lang=en', fr: 'https://thegodnationacademy.org/welcome?ref=MARY123&lang=fr' },
        },
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Outreach Message Links')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('https://thegodnationacademy.org/welcome?ref=MARY123&lang=en')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://thegodnationacademy.org/welcome?ref=MARY123&lang=fr')).toBeInTheDocument();
    // The regular /join link is still shown separately, unaffected.
    expect(screen.getByDisplayValue('https://thegodnationacademy.org/join?ref=MARY123&lang=en')).toBeInTheDocument();
  });

  it('copying the outreach link shows its own "Copied!" state without affecting the regular link row', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/links': {
        status: 200,
        body: {
          referralCode: 'MARY123',
          links: { en: 'https://thegodnationacademy.org/join?ref=MARY123&lang=en', fr: 'https://thegodnationacademy.org/join?ref=MARY123&lang=fr' },
          outreachLinks: { en: 'https://thegodnationacademy.org/welcome?ref=MARY123&lang=en', fr: 'https://thegodnationacademy.org/welcome?ref=MARY123&lang=fr' },
        },
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Outreach Message Links')).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByText('Copy');
    // The outreach card's EN row copy button — first "Copy" belongs to the
    // regular Links card (rendered above), so the outreach card's EN row is
    // the third button (regular EN, regular FR, outreach EN, outreach FR).
    fireEvent.click(copyButtons[2]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://thegodnationacademy.org/welcome?ref=MARY123&lang=en');
    });
    expect(screen.getAllByText('Copied!')).toHaveLength(1);
  });

  it('does not render the outreach card when the Leader has no active referral code', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/links': { status: 200, body: { referralCode: null, links: null, outreachLinks: null } },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('No active referral code assigned yet.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Outreach Message Links')).not.toBeInTheDocument();
  });
});
