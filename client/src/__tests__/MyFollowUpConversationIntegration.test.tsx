import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyFollowUp } from '../components/leader/MyFollowUp';

// Phase 3M.2 — confirms the shared FollowUpConversation panel is wired into
// the Leader's existing "My Follow-Up" detail view (opened via "View"),
// without disturbing any of its existing Phase 3D/3I behavior (log contact,
// reassign, close, attention). Same URL-dispatching fetch mock pattern as
// FollowUpConversation.test.tsx.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      // Longest-key-first so a more specific path (e.g. .../conversation/messages)
      // is never shadowed by a shorter one that happens to be a substring of it
      // (e.g. .../conversation).
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

const BASE_MOCKS = {
  '/api/leader/role-assignments': { status: 200, body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] } },
  '/api/leader/follow-ups/attention': { status: 200, body: { items: [] } },
  '/api/leader/follow-ups/f1/contacts': { status: 200, body: { items: [] } },
};

describe('MyFollowUp — Phase 3M.2 conversation integration', () => {
  it('shows the conversation panel when a Follow-Up is opened, alongside the existing log-contact form', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'ACTIVE', contextType: 'COMMUNITY', contextId: 'c1', followedPerson: { id: 'p1', name: 'Candidate Person' }, contacts: [] }] },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'ACTIVE' } },
      '/api/follow-ups/f1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Candidate Person', body: 'Thanks for checking in.', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<MyFollowUp />);

    fireEvent.click(await screen.findByText('View'));

    await waitFor(() => {
      expect(screen.getByText('Thanks for checking in.')).toBeInTheDocument();
    });
    // Existing Phase 3D log-contact form is still present, unaffected.
    expect(screen.getByText('Log a Contact')).toBeInTheDocument();
  });

  it('shows the conversation as read-only (no composer) once the Follow-Up is closed, and hides the log-contact form', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'CLOSED', contextType: 'COMMUNITY', contextId: 'c1', followedPerson: { id: 'p1', name: 'Candidate Person' }, contacts: [] }] },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'CLOSED' } },
      '/api/follow-ups/f1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Candidate Person', body: 'Historical message.', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<MyFollowUp />);

    fireEvent.click(await screen.findByText('View'));

    await waitFor(() => {
      expect(screen.getByText('This follow-up has been closed. The conversation is read-only.')).toBeInTheDocument();
    });
    expect(screen.getByText('Historical message.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Write a message…')).not.toBeInTheDocument();
    // Existing Phase 3D log-contact form is correctly hidden for a closed assignment (pre-existing behavior).
    expect(screen.queryByText('Log a Contact')).not.toBeInTheDocument();
  });
});
