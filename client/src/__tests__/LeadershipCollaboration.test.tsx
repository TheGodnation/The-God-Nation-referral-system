import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LeadershipCollaboration } from '../components/LeadershipCollaboration';
import i18n from '../i18n';

// Phase 2B — same URL-dispatching fetch mock pattern established for
// CommunityConversation.test.tsx.
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

describe('LeadershipCollaboration', () => {
  it('shows the generation label, message history, and sender name', async () => {
    mockFetchByUrl({
      '/leadership-collaboration/1/messages': {
        status: 200,
        body: { items: [{ id: 'm1', senderName: 'Jane Doe', body: 'Let us coordinate.', createdAt: '2026-01-10T00:00:00Z' }], hasMore: false },
      },
    });

    render(<LeadershipCollaboration generation={1} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Let us coordinate.')).toBeInTheDocument();
    expect(screen.getByText('Generation 1 — Leadership Collaboration')).toBeInTheDocument();
  });

  it('shows a loading state before the fetch resolves', () => {
    mockFetchByUrl({
      '/leadership-collaboration/1/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeadershipCollaboration generation={1} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an empty state when there are no messages', async () => {
    mockFetchByUrl({
      '/leadership-collaboration/1/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeadershipCollaboration generation={1} />);

    await waitFor(() => {
      expect(screen.getByText('No collaboration messages yet. Be the first to say something.')).toBeInTheDocument();
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({
      '/leadership-collaboration/1/messages': { status: 404, body: { error: 'not found' } },
    });

    render(<LeadershipCollaboration generation={1} />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load collaboration.')).toBeInTheDocument();
    });
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
            json: async () => ({ id: 'm-new', body: 'A coordination message', createdAt: '2026-01-11T00:00:00Z' }),
          });
        }
        const items = sent
          ? [{ id: 'm-new', senderName: 'Me', body: 'A coordination message', createdAt: '2026-01-11T00:00:00Z' }]
          : [];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ items, hasMore: false }),
        });
      }),
    );

    render(<LeadershipCollaboration generation={2} />);

    await waitFor(() => {
      expect(screen.getByText('No collaboration messages yet. Be the first to say something.')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Write a message…');
    fireEvent.change(textarea, { target: { value: 'A coordination message' } });
    fireEvent.click(screen.getByText('Send message'));

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.url).toContain('/api/leader/leadership-collaboration/2/messages');
      expect(postCall!.body).toEqual({ body: 'A coordination message' });
    });

    await waitFor(() => {
      expect(screen.getByText('A coordination message')).toBeInTheDocument();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('renders in French when the active language is French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/leadership-collaboration/1/messages': { status: 200, body: { items: [], hasMore: false } },
    });

    render(<LeadershipCollaboration generation={1} />);

    await waitFor(() => {
      expect(screen.getByText('Aucun message de collaboration pour l\'instant. Soyez le premier à écrire.')).toBeInTheDocument();
    });
    expect(screen.getByText('Génération 1 — Collaboration de leadership')).toBeInTheDocument();
    expect(screen.getByText('Envoyer le message')).toBeInTheDocument();
  });
});
