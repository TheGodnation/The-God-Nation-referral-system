import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrivateMessages } from '../components/PrivateMessages';
import i18n from '../i18n';

// Private Communication / Messaging — shared Member/Leader/Admin
// participant view. Same URL-dispatching fetch mock pattern established by
// HeadquartersPosts.test.ts.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
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
  calls.length = 0;
  i18n.changeLanguage('en');
});

const ONE_CONVERSATION = {
  items: [{ id: 'c1', createdAt: '2026-01-01T00:00:00Z', otherPartyType: 'CENTRAL_AUTHORITY', unreadCount: 1 }],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

describe('PrivateMessages (shared Member/Leader/Admin participant view)', () => {
  it('renders nothing when there are no conversations and alwaysShow is not set', async () => {
    mockFetchByUrl({ '/api/private-messages/conversations': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } } });

    const { container } = render(<PrivateMessages />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('shows an empty state when alwaysShow is set and there are no conversations', async () => {
    mockFetchByUrl({ '/api/private-messages/conversations': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } } });

    render(<PrivateMessages alwaysShow />);

    await waitFor(() => {
      expect(screen.getByText('No private conversations yet.')).toBeInTheDocument();
    });
  });

  it('lists a conversation with a Central Authority label and unread count', async () => {
    mockFetchByUrl({ '/api/private-messages/conversations': { status: 200, body: ONE_CONVERSATION } });

    render(<PrivateMessages />);

    await waitFor(() => {
      expect(screen.getByText('Central Authority')).toBeInTheDocument();
    });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows a Leader label with the Leader\'s name when otherPartyType is LEADER', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations': {
        status: 200,
        body: { items: [{ id: 'c2', createdAt: '2026-01-01T00:00:00Z', otherPartyType: 'LEADER', otherPartyName: 'Jane Leader', unreadCount: 0 }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
      },
    });

    render(<PrivateMessages />);

    await waitFor(() => {
      expect(screen.getByText('Jane Leader (Leader)')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading the list fails', async () => {
    mockFetchByUrl({ '/api/private-messages/conversations': { status: 500, body: { error: 'boom' } } });

    render(<PrivateMessages alwaysShow />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load private messages.')).toBeInTheDocument();
    });
  });

  it('opens a conversation, renders message history, and marks it read', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations/c1/read': { status: 200, body: { unreadCount: 0 } },
      '/api/private-messages/conversations/c1/messages': {
        status: 200,
        body: {
          items: [{ id: 'm1', isOwn: false, body: 'Welcome to the community!', createdAt: '2026-01-01T00:00:00Z' }],
          hasMore: false,
          unreadCount: 1,
          otherPartyType: 'CENTRAL_AUTHORITY',
        },
      },
      '/api/private-messages/conversations': { status: 200, body: ONE_CONVERSATION },
    });

    render(<PrivateMessages />);
    fireEvent.click(await screen.findByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Welcome to the community!')).toBeInTheDocument();
    });
    expect(screen.getByText('Back')).toBeInTheDocument();

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/c1/read'))).toBe(true);
    });
  });

  it('sends a new message and appends it to the conversation', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations/c1/messages': {
        status: 200,
        body: { items: [], hasMore: false, unreadCount: 0, otherPartyType: 'CENTRAL_AUTHORITY' },
      },
      '/api/private-messages/conversations': { status: 200, body: ONE_CONVERSATION },
    });

    render(<PrivateMessages />);
    fireEvent.click(await screen.findByText('Open'));
    await waitFor(() => expect(screen.getByText('No messages yet.')).toBeInTheDocument());

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes('/messages') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'm2', isOwn: true, body: 'Thank you!', createdAt: '2026-01-02T00:00:00Z' }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
      }),
    );

    fireEvent.change(screen.getByPlaceholderText('Write a message…'), { target: { value: 'Thank you!' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Thank you!')).toBeInTheDocument();
    });
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({ '/api/private-messages/conversations': { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } } });

    render(<PrivateMessages alwaysShow />);

    await waitFor(() => {
      expect(screen.getByText('Aucune conversation privée pour le moment.')).toBeInTheDocument();
    });
    expect(screen.getByText('Messages privés')).toBeInTheDocument();
  });
});
