import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CentralAuthorityConversationOversight } from '../components/admin/CentralAuthorityConversationOversight';
import i18n from '../i18n';

// Phase 3M.8B — Central Authority Conversation Oversight. Mirrors the exact
// URL-dispatching fetch mock pattern established in
// CommunityConversation.test.tsx (Phase 3M.1/3M.7/3M.8A).
const calls: { url: string; method: string }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
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

describe('CentralAuthorityConversationOversight', () => {
  it('shows the reason form first, with no request fired until a reason is submitted', () => {
    mockFetchByUrl({});
    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);

    expect(screen.getByText('View Conversation')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('the view button stays disabled until a reason is picked', () => {
    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    const button = screen.getByText('View Conversation') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SECURITY' } });
    expect(button.disabled).toBe(false);
  });

  it('selecting OTHER reveals a required explanation field, and the button stays disabled until it is filled', () => {
    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'OTHER' } });

    const button = screen.getByText('View Conversation') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByPlaceholderText('Briefly explain the reason…')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Briefly explain the reason…'), { target: { value: 'Reported concern' } });
    expect(button.disabled).toBe(false);
  });

  it('submitting a reason fetches the conversation with that reason in the query string', async () => {
    mockFetchByUrl({
      '/api/admin/communities/c1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SECURITY' } });
    fireEvent.click(screen.getByText('View Conversation'));

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
    const call = calls.find((c) => c.method === 'GET' && c.url.includes('conversation/messages'));
    expect(call!.url).toContain('reason=SECURITY');
    expect(call!.url).not.toContain('reasonNote');
  });

  it('submitting reason=OTHER includes the trimmed reasonNote in the request', async () => {
    mockFetchByUrl({
      '/api/admin/geographies/g1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/geographies/g1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByPlaceholderText('Briefly explain the reason…'), { target: { value: '  Suspicious activity  ' } });
    fireEvent.click(screen.getByText('View Conversation'));

    await waitFor(() => {
      const call = calls.find((c) => c.method === 'GET');
      expect(call!.url).toContain('reason=OTHER');
      // URLSearchParams encodes spaces as '+', not '%20' — this confirms the
      // note was trimmed (no leading/trailing space) and included verbatim.
      expect(call!.url).toContain('reasonNote=Suspicious+activity');
    });
  });

  it('shows a load-failed error, and the reason form does not reappear', async () => {
    mockFetchByUrl({
      '/api/admin/communities/c1/conversation/messages': { status: 403, body: { error: 'Not authorized.' } },
    });

    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SECURITY' } });
    fireEvent.click(screen.getByText('View Conversation'));

    await waitFor(() => {
      expect(screen.getByText('Not authorized.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows "load older messages" only when hasMore is true, and resends the same reason with a before cursor', async () => {
    mockFetchByUrl({
      '/api/admin/communities/c1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm2', senderName: 'Jane', body: 'Recent', createdAt: '2026-01-10T00:00:00Z' }], hasMore: true },
      },
    });

    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ABUSE_OR_SAFEGUARDING' } });
    fireEvent.click(screen.getByText('View Conversation'));

    const loadOlder = await screen.findByText('Load older messages');
    calls.length = 0;
    mockFetchByUrl({
      '/api/admin/communities/c1/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm0', senderName: 'Jane', body: 'Older', createdAt: '2026-01-01T00:00:00Z' }], hasMore: false },
      },
    });
    fireEvent.click(loadOlder);

    await waitFor(() => {
      expect(screen.getByText('Older')).toBeInTheDocument();
    });
    const call = calls.find((c) => c.method === 'GET');
    expect(call!.url).toContain('reason=ABUSE_OR_SAFEGUARDING');
    expect(call!.url).toContain('before=m2');
  });

  it('shows a "Removed by" badge for a moderated message, and still displays the unredacted body Central Authority receives', async () => {
    mockFetchByUrl({
      '/api/admin/communities/c1/conversation/messages': {
        status: 200,
        body: {
          items: [
            {
              id: 'm1',
              senderName: 'Jane Doe',
              body: 'the original removed text',
              createdAt: '2026-01-10T00:00:00Z',
              deleted: true,
              deletedByName: 'Community Leader',
            },
          ],
          hasMore: false,
        },
      },
    });

    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SECURITY' } });
    fireEvent.click(screen.getByText('View Conversation'));

    await waitFor(() => {
      expect(screen.getByText('the original removed text')).toBeInTheDocument();
    });
    expect(screen.getByText('Removed by Community Leader')).toBeInTheDocument();
  });

  it('closing the viewer resets back to the reason form', async () => {
    mockFetchByUrl({
      '/api/admin/communities/c1/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SECURITY' } });
    fireEvent.click(screen.getByText('View Conversation'));

    await screen.findByText('Close');
    fireEvent.click(screen.getByText('Close'));

    expect(screen.getByText('View Conversation')).toBeInTheDocument();
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });

  it('renders in French when the active language is French', () => {
    i18n.changeLanguage('fr');
    render(<CentralAuthorityConversationOversight messagesUrl="/api/admin/communities/c1/conversation/messages" />);

    expect(screen.getByText('Voir la conversation')).toBeInTheDocument();
    expect(screen.getByText('Sélectionner un motif…')).toBeInTheDocument();
  });
});
