import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('Geography Retirement Step 5A: shows the "no active role" state for a Leader who only holds a Geography-scoped role — Follow-Up is Community-scoped only', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'g1', name: 'My Region', type: 'REGION' } }] },
      },
    });
    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText(/You don't have an active scoped leader role yet/i)).toBeInTheDocument();
    });
  });

  it('Geography Retirement Step 5A: the create-follow-up scope dropdown offers only the Community role, never the Geography one, when a Leader holds both', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: {
          items: [
            { id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null },
            { id: 'r2', community: null, geography: { id: 'g1', name: 'My Region', type: 'REGION' } },
          ],
        },
      },
      '/api/leader/follow-ups': { status: 200, body: { items: [] } },
      '/api/leader/follow-ups/attention': { status: 200, body: { items: [] } },
    });
    render(<MyFollowUp />);

    fireEvent.click(await screen.findByText('+ New Follow-Up'));

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('My Community');
    expect(options).not.toContain('My Region');
  });
});
