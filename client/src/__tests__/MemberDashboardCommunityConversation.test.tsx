import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberDashboardPage } from '../pages/MemberDashboardPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// Phase 3M.1 — same URL-dispatching fetch mock pattern as
// MemberDashboardTrainingProgress.test.tsx.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const match = Object.keys(responses).find((key) => url.includes(key));
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
      <MemberAuthProvider>
        <MemberDashboardPage />
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

const BASE_MOCKS = {
  '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
  '/api/member/devotionals': { status: 200, body: { items: [] } },
  '/api/member/me/geographic-assignment': { status: 200, body: { assignment: null } },
  '/api/member/me/training-progress': { status: 200, body: { totalEligible: 0, completedCount: 0, items: [] } },
};

describe('MemberDashboardPage — Phase 3M.1 Community Conversation', () => {
  it('renders a conversation panel for an ACTIVE community membership', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/member/me/community-memberships': {
        status: 200,
        body: { items: [{ communityId: 'c1', communityName: 'My Community', status: 'ACTIVE', joinedAt: '2026-01-01T00:00:00Z' }] },
      },
      '/api/communities/c1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('My Community — Conversation')).toBeInTheDocument();
    });
  });

  it('does not render a conversation panel for an INACTIVE community membership', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/member/me/community-memberships': {
        status: 200,
        body: { items: [{ communityId: 'c2', communityName: 'Old Community', status: 'INACTIVE', joinedAt: '2026-01-01T00:00:00Z' }] },
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Old Community — Inactive')).toBeInTheDocument();
    });
    expect(screen.queryByText('Old Community — Conversation')).not.toBeInTheDocument();
  });

  it('renders no conversation panel when the member has no community memberships', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/member/me/community-memberships': { status: 200, body: { items: [] } },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Not a member of any community yet.')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Conversation$/)).not.toBeInTheDocument();
  });
});
