import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberDashboardPage } from '../pages/MemberDashboardPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// Phase 3E — same URL-dispatching fetch mock pattern as
// TrainingProgress.test.tsx. MemberDashboardPage fires several requests on
// mount (member session, devotionals, community memberships, geographic
// assignment, training progress, plus the unrelated public-settings fetch
// used by PageShell) — each is mocked by URL; anything not listed here
// falls through to a 404, which every one of these hooks already handles
// gracefully via .catch().
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

describe('MemberDashboardPage — Phase 3E training progress', () => {
  it('shows the overall X of Y summary and a Completed badge for a passed devotional', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
      '/api/member/devotionals': {
        status: 200,
        body: { items: [{ id: 'd1', titleEn: 'Devotional One', titleFr: null, descriptionEn: null, descriptionFr: null, community: null, assessments: [{ id: 'a1', titleEn: 'Quiz', titleFr: null, passMark: 50, maxAttempts: null, status: 'PUBLISHED' }] }] },
      },
      '/api/member/me/community-memberships': { status: 200, body: { items: [] } },
      '/api/member/me/geographic-assignment': { status: 200, body: { assignment: null } },
      '/api/member/me/training-progress': {
        status: 200,
        body: { totalEligible: 1, completedCount: 1, items: [{ devotionalId: 'd1', attempted: true, completed: true, bestPercentage: 90 }] },
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('1 of 1 completed')).toBeInTheDocument();
    });
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Best: 90%')).toBeInTheDocument();
  });

  it('shows "Not yet" for an eligible devotional with no passed attempt', async () => {
    mockFetchByUrl({
      '/api/member/auth/me': { status: 200, body: { member: { name: 'Jane', email: 'jane@example.com', preferredLanguage: 'en' } } },
      '/api/member/devotionals': {
        status: 200,
        body: { items: [{ id: 'd2', titleEn: 'Devotional Two', titleFr: null, descriptionEn: null, descriptionFr: null, community: null, assessments: [{ id: 'a2', titleEn: 'Quiz', titleFr: null, passMark: 50, maxAttempts: null, status: 'PUBLISHED' }] }] },
      },
      '/api/member/me/community-memberships': { status: 200, body: { items: [] } },
      '/api/member/me/geographic-assignment': { status: 200, body: { assignment: null } },
      '/api/member/me/training-progress': {
        status: 200,
        body: { totalEligible: 1, completedCount: 0, items: [{ devotionalId: 'd2', attempted: false, completed: false, bestPercentage: null }] },
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Not yet')).toBeInTheDocument();
    });
    expect(screen.getByText('0 of 1 completed')).toBeInTheDocument();
  });
});
