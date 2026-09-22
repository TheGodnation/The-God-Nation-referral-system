import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TrainingProgress } from '../components/leader/TrainingProgress';

// Phase 3E — mirrors the fetch-mocking pattern already established in
// MyFollowUp.test.tsx (Phase 3D). TrainingProgress makes two sequential
// requests (role-assignments, then community-progress), so this mock
// dispatches a response per URL rather than a single fixed one.
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

describe('TrainingProgress', () => {
  it('renders nothing for a Geography-only Leader (no Community-scoped role)', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'g1', name: 'Some Region', type: 'REGION' } }] },
      },
    });

    const { container } = render(<TrainingProgress />);

    await waitFor(() => {
      expect(container.innerHTML).toBe('');
    });
  });

  it('shows the community completion table for a Community-scoped Leader', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/community-progress': {
        status: 200,
        body: {
          items: [
            { personId: 'p1', name: 'Jane Doe', totalEligible: 2, completedCount: 2, completed: true, bestPercentage: 95, lastAttemptAt: '2026-10-01T00:00:00Z' },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<TrainingProgress />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
