import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyMembers } from '../components/leader/MyMembers';

// Phase 3J — Workflow B: Roster → Start Follow-Up. Same URL-dispatching
// fetch mock pattern as MyMembers.test.tsx, extended to record every call so
// tests can assert exactly what the create-follow-up POST sent.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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
  calls.length = 0;
});

describe('MyMembers — Phase 3J Roster → Start Follow-Up', () => {
  it('renders a Start Follow-Up action for each roster member', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Start Follow-Up')).toBeInTheDocument();
  });

  it('submits the correct personId with COMMUNITY contextType and the selected community ID', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 201, body: { id: 'assignment-1' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Start Follow-Up'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.url === '/api/leader/follow-ups' && c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toEqual({ followedPersonId: 'p1', contextType: 'COMMUNITY', contextId: 'c1' });
    });
  });

  it('submits GEOGRAPHY contextType and the selected geography ID for a Geography roster', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: null, geography: { id: 'g1', name: 'My Region', type: 'REGION' } }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'GEOGRAPHY',
          scopeId: 'g1',
          items: [{ personId: 'p2', name: 'John Smith', geographicAssignedAt: '2026-02-20T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 201, body: { id: 'assignment-2' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Start Follow-Up'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.url === '/api/leader/follow-ups' && c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toEqual({ followedPersonId: 'p2', contextType: 'GEOGRAPHY', contextId: 'g1' });
    });
  });

  it('shows success feedback after successfully starting a follow-up', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 201, body: { id: 'assignment-1' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Start Follow-Up'));

    await waitFor(() => {
      expect(screen.getByText('Follow-up started.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Start Follow-Up')).not.toBeInTheDocument();
  });

  it('surfaces the existing 409 conflict response when a follow-up already exists', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      '/api/leader/follow-ups': { status: 409, body: { error: 'You already have an active follow-up assignment with this person.' } },
    });

    render(<MyMembers />);

    fireEvent.click(await screen.findByText('Start Follow-Up'));

    await waitFor(() => {
      expect(screen.getByText('You already have an active follow-up assignment with this person.')).toBeInTheDocument();
    });
    // The button remains available — no client-side duplicate-detection hides it.
    expect(screen.getByText('Start Follow-Up')).toBeInTheDocument();
  });

  it('leaves existing roster rendering intact', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] },
      },
      '/api/leader/roster': {
        status: 200,
        body: {
          scopeType: 'COMMUNITY',
          scopeId: 'c1',
          items: [{ personId: 'p1', name: 'Jane Doe', membershipJoinedAt: '2026-01-15T00:00:00Z' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
    });

    render(<MyMembers />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Joined')).toBeInTheDocument();
  });

  it('renders the English and French start-follow-up strings through the normal i18n system', async () => {
    const en = await import('../i18n/en.json');
    const fr = await import('../i18n/fr.json');
    expect((en.default as any).leader.myMembers.start_followup).toBe('Start Follow-Up');
    expect((fr.default as any).leader.myMembers.start_followup).toBe('Démarrer le suivi');
  });
});
