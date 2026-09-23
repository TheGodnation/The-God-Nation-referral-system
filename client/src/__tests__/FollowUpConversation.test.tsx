import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FollowUpConversation } from '../components/FollowUpConversation';
import i18n from '../i18n';

// Phase 3M.2 — same URL-dispatching fetch mock pattern established across
// prior phases' client tests (e.g. CommunityConversation.test.tsx).
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
  i18n.changeLanguage('en');
});

describe('FollowUpConversation', () => {
  it('shows recent messages, sender name, and timestamp for an active follow-up', async () => {
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Mary Ngu', body: 'How are you doing?', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { id: 'c1', followUpAssignmentId: 'f1', createdAt: '2026-01-01T00:00:00Z', assignmentStatus: 'ACTIVE' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('Mary Ngu')).toBeInTheDocument();
    });
    expect(screen.getByText('How are you doing?')).toBeInTheDocument();
    expect(screen.getByText('Conversation')).toBeInTheDocument();
  });

  it('shows the composer for an ACTIVE assignment', async () => {
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'ACTIVE' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Write a message…')).toBeInTheDocument();
    });
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.queryByText('This follow-up has been closed. The conversation is read-only.')).not.toBeInTheDocument();
  });

  it('hides the composer and shows a read-only note for a CLOSED assignment', async () => {
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Mary Ngu', body: 'Historical message.', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'CLOSED' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('This follow-up has been closed. The conversation is read-only.')).toBeInTheDocument();
    });
    expect(screen.getByText('Historical message.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Write a message…')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no messages', async () => {
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'ACTIVE' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet.')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': { status: 500, body: { error: 'boom' } },
      '/api/follow-ups/f1/conversation': { status: 500, body: { error: 'boom' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load the conversation.')).toBeInTheDocument();
    });
  });

  it('shows "load older messages" only when hasMore is true, and fetches with a before cursor', async () => {
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm2', senderName: 'Mary', body: 'Recent', createdAt: '2026-01-10T00:00:00Z' }], hasMore: true },
      },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'ACTIVE' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    const loadOlder = await screen.findByText('Load older messages');
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push({ url, method: 'GET', body: undefined });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items: [{ id: 'm0', senderName: 'Mary', body: 'Older message', createdAt: '2026-01-01T00:00:00Z' }], hasMore: false }),
        });
      }),
    );
    fireEvent.click(loadOlder);

    await waitFor(() => {
      expect(screen.getByText('Older message')).toBeInTheDocument();
    });
    const call = calls.find((c) => c.url.includes('/conversation/messages'));
    expect(call!.url).toContain('before=m2');
  });

  it('sends a message and refreshes, clearing the composer', async () => {
    let sent = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'POST') {
          sent = true;
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'm-new', body: 'A new message', createdAt: '2026-01-11T00:00:00Z' }),
          });
        }
        if (url.includes('/conversation/messages')) {
          const items = sent ? [{ id: 'm-new', senderName: 'Me', body: 'A new message', createdAt: '2026-01-11T00:00:00Z' }] : [];
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ items, hasMore: false }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ assignmentStatus: 'ACTIVE' }),
        });
      }),
    );

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet.')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Write a message…');
    fireEvent.change(textarea, { target: { value: 'A new message' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toEqual({ body: 'A new message' });
    });

    await waitFor(() => {
      expect(screen.getByText('A new message')).toBeInTheDocument();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/follow-ups/f1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
      '/api/follow-ups/f1/conversation': { status: 200, body: { assignmentStatus: 'ACTIVE' } },
    });

    render(<FollowUpConversation followUpAssignmentId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('Aucun message pour l\'instant.')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Écrire un message…')).toBeInTheDocument();
    expect(screen.getByText('Envoyer')).toBeInTheDocument();
  });
});
