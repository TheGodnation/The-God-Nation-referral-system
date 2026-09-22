import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MyFollowUp } from '../components/leader/MyFollowUp';

// Phase 3D — MyFollowUp fetches directly via the shared `api` client (which
// itself wraps `fetch`), so mocking global.fetch here is enough to drive
// both of its documented empty states without introducing a new mocking
// pattern into this otherwise very lightly-tested client codebase.
function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MyFollowUp', () => {
  it('shows the "not linked" state when the Leader account has no linked Person', async () => {
    mockFetchOnce(403, { error: 'Your account is not yet linked to a Person. Ask an Admin to link it.' });
    render(<MyFollowUp />);

    await waitFor(() => {
      expect(
        screen.getByText(/Your account isn't linked to a person profile yet/i),
      ).toBeInTheDocument();
    });
  });

  it('shows the "no active role" state when linked but with zero active RoleAssignments', async () => {
    mockFetchOnce(200, { items: [] });
    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText(/You don't have an active scoped leader role yet/i)).toBeInTheDocument();
    });
  });
});
