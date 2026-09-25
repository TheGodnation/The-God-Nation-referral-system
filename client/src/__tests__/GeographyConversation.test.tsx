import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GeographyConversation } from '../components/GeographyConversation';
import i18n from '../i18n';

// Phase 3M.6 — same URL-dispatching fetch mock pattern established for
// CommunityConversation.test.tsx (Phase 3M.1).
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

describe('GeographyConversation', () => {
  it('shows recent messages, sender name, and timestamp', async () => {
    mockFetchByUrl({
      '/conversation/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Hello neighbors!', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello neighbors!')).toBeInTheDocument();
    expect(screen.getByText('Quarter A — Conversation')).toBeInTheDocument();
  });

  it('shows an empty state when there are no messages', async () => {
    mockFetchByUrl({
      '/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({
      '/conversation/messages': { status: 500, body: { error: 'boom' } },
    });

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

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

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

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

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

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

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
    });

    const sendButton = screen.getByText('Send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Write a message…'), { target: { value: 'Something' } });
    expect(sendButton.disabled).toBe(false);
  });

  it('surfaces a send error without clearing the composer, and never blocks re-reading the conversation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 404,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Geography conversation not found.' }),
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

    render(<GeographyConversation geographyId="g1" geographyName="Quarter A" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet. Be the first to say something.')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Write a message…');
    fireEvent.change(textarea, { target: { value: 'Blocked message' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(screen.getByText('Geography conversation not found.')).toBeInTheDocument();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('Blocked message');
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/conversation/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<GeographyConversation geographyId="g1" geographyName="Quartier A" />);

    await waitFor(() => {
      expect(screen.getByText("Aucun message pour l'instant. Soyez le premier à écrire.")).toBeInTheDocument();
    });
    expect(screen.getByText('Quartier A — Conversation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Écrire un message…')).toBeInTheDocument();
    expect(screen.getByText('Envoyer')).toBeInTheDocument();
  });
});
