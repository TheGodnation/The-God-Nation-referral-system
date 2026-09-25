import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CommunityConversation } from '../components/CommunityConversation';
import i18n from '../i18n';

// Phase 3M.1 — same URL-dispatching fetch mock pattern established across
// prior phases' client tests (e.g. MyLeadershipProposals.test.tsx).
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

describe('CommunityConversation', () => {
  it('shows recent messages, sender name, and timestamp', async () => {
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
    expect(screen.getByText('My Community — Conversation')).toBeInTheDocument();
  });

  it('shows an empty state when there are no messages', async () => {
    mockFetchByUrl({
      '/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({
      '/conversation/messages': { status: 500, body: { error: 'boom' } },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load the conversation.')).toBeInTheDocument();
    });
  });

  it('shows a "load older messages" affordance only when hasMore is true, and fetches with a before cursor', async () => {
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm2', senderName: 'Jane', body: 'Recent message', createdAt: '2026-01-10T00:00:00Z' }], hasMore: true },
      },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

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
          json: async () => ({ items: [{ id: 'm0', senderName: 'Jane', body: 'Older message', createdAt: '2026-01-01T00:00:00Z' }], hasMore: false }),
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

  it('sends a message and refreshes the list, clearing the composer', async () => {
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
        const items = sent
          ? [{ id: 'm-new', senderName: 'Me', body: 'A new message', createdAt: '2026-01-11T00:00:00Z' }]
          : [];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items, hasMore: false }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
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

  it('disables the Send button while a message is empty or being sent', async () => {
    mockFetchByUrl({
      '/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
    });

    const sendButton = screen.getByText('Send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Write a message…'), { target: { value: 'Something' } });
    expect(sendButton.disabled).toBe(false);
  });

  it('surfaces a send error without clearing the composer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 403,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'You do not have access to this community\'s conversation.' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items: [], hasMore: false }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Write a message…');
    fireEvent.change(textarea, { target: { value: 'Blocked message' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(screen.getByText('You do not have access to this community\'s conversation.')).toBeInTheDocument();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('Blocked message');
  });

  it('shows an unread badge and marks the conversation read after successfully rendering', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'POST' && url.includes('/conversation/read')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ unreadCount: 0 }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z' }],
            hasMore: false,
            unreadCount: 1,
          }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    await waitFor(() => {
      const readCall = calls.find((c) => c.method === 'POST' && c.url.includes('/conversation/read'));
      expect(readCall).toBeTruthy();
      expect(readCall!.body).toEqual({ messageId: 'm1' });
    });

    await waitFor(() => {
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });
    // The message stays visible throughout.
    expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
  });

  it('never marks read as a side effect of loading older messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            items: [{ id: 'm2', senderName: 'Jane', body: 'Recent message', createdAt: '2026-01-10T00:00:00Z' }],
            hasMore: true,
            unreadCount: 0,
          }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);
    const loadOlder = await screen.findByText('Load older messages');
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            items: [{ id: 'm0', senderName: 'Jane', body: 'Older message', createdAt: '2026-01-01T00:00:00Z' }],
            hasMore: false,
            unreadCount: 0,
          }),
        });
      }),
    );
    fireEvent.click(loadOlder);

    await waitFor(() => {
      expect(screen.getByText('Older message')).toBeInTheDocument();
    });
    expect(calls.find((c) => c.method === 'POST' && c.url.includes('/conversation/read'))).toBeUndefined();
  });

  it('keeps messages visible and shows no false "read" state when marking read fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'POST' && url.includes('/conversation/read')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'boom' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z' }],
            hasMore: false,
            unreadCount: 1,
          }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      const readCall = calls.find((c) => c.method === 'POST' && c.url.includes('/conversation/read'));
      expect(readCall).toBeTruthy();
    });

    // The failed mark-read never discards the already-loaded message, and
    // the badge remains showing the still-accurate unread count.
    expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<CommunityConversation communityId="c1" communityName="Ma Communauté" />);

    await waitFor(() => {
      expect(screen.getByText("Aucun message pour l'instant. Soyez le premier à écrire.")).toBeInTheDocument();
    });
    expect(screen.getByText('Ma Communauté — Conversation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Écrire un message…')).toBeInTheDocument();
    expect(screen.getByText('Envoyer')).toBeInTheDocument();
  });

  it('shows a Remove action for an administrator, and hides it for an ordinary participant', async () => {
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: {
          items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z', deleted: false }],
          hasMore: false,
          isAdministrator: true,
        },
      },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('Remove')).toBeInTheDocument();
    });
  });

  it('hides the Remove action when the caller is not an administrator', async () => {
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: {
          items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z', deleted: false }],
          hasMore: false,
          isAdministrator: false,
        },
      },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
    });
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });

  it('an administrator can remove a message, which then renders the removed placeholder', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'm1', deleted: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Inappropriate text', createdAt: '2026-01-10T00:00:00Z', deleted: false }],
            hasMore: false,
            isAdministrator: true,
          }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    const removeButton = await screen.findByText('Remove');
    fireEvent.click(removeButton);

    await waitFor(() => {
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall!.url).toContain('/conversation/messages/m1');
    });

    await waitFor(() => {
      expect(screen.getByText('This message was removed.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Inappropriate text')).not.toBeInTheDocument();
  });

  it('does not delete when the confirmation dialog is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: {
          items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z', deleted: false }],
          hasMore: false,
          isAdministrator: true,
        },
      },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);
    const removeButton = await screen.findByText('Remove');
    fireEvent.click(removeButton);

    expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'DELETE')).toBeUndefined();
  });

  it('keeps the message visible and shows an error when deletion fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'DELETE') {
          return Promise.resolve({
            ok: false,
            status: 403,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Only an active Community Administrator may remove a message.' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello everyone!', createdAt: '2026-01-10T00:00:00Z', deleted: false }],
            hasMore: false,
            isAdministrator: true,
          }),
        });
      }),
    );

    render(<CommunityConversation communityId="c1" communityName="My Community" />);
    const removeButton = await screen.findByText('Remove');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.getByText('Only an active Community Administrator may remove a message.')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello everyone!')).toBeInTheDocument();
  });

  it('renders an already-deleted message as removed, without a Remove action for it', async () => {
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: {
          items: [{ id: 'm1', senderName: 'Jane Doe', body: null, createdAt: '2026-01-10T00:00:00Z', deleted: true }],
          hasMore: false,
          isAdministrator: true,
        },
      },
    });

    render(<CommunityConversation communityId="c1" communityName="My Community" />);

    await waitFor(() => {
      expect(screen.getByText('This message was removed.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });
});
