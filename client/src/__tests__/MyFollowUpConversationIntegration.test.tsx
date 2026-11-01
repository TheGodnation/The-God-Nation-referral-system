import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyFollowUp } from '../components/leader/MyFollowUp';

// The follow-up conversation is now the normal private chat between the
// leader and the person: "My Follow-Up" opens it from the detail view, next
// to the log-contact form, without disturbing log contact, reassign or close.
const calls: { url: string; method: string }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
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
});

const BASE_MOCKS = {
  '/api/leader/role-assignments': { status: 200, body: { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] } },
  '/api/leader/follow-ups/attention': { status: 200, body: { items: [] } },
  '/api/leader/follow-ups/f1/contacts': { status: 200, body: { items: [] } },
};

describe('MyFollowUp — private chat integration', () => {
  it('offers the private chat when a Follow-Up is opened, alongside the log-contact form', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'ACTIVE', contextType: 'COMMUNITY', contextId: 'c1', followedPerson: { id: 'p1', name: 'Candidate Person' }, contacts: [] }] },
      },
      '/api/leader/my-people/p1/chat': { status: 200, body: { conversationId: 'conv-1' } },
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });

    render(<MyFollowUp />);
    fireEvent.click(await screen.findByText('View'));

    expect(await screen.findByText('Log a Contact')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/member/chats/private/conv-1'));
    expect(calls.some((c) => c.url.includes('/api/leader/my-people/p1/chat') && c.method === 'POST')).toBe(true);
  });

  it('hides the log-contact form for a closed follow-up (existing behavior)', async () => {
    mockFetchByUrl({
      ...BASE_MOCKS,
      '/api/leader/follow-ups': {
        status: 200,
        body: { items: [{ id: 'f1', status: 'CLOSED', contextType: 'COMMUNITY', contextId: 'c1', followedPerson: { id: 'p1', name: 'Candidate Person' }, contacts: [] }] },
      },
    });
    render(<MyFollowUp />);
    fireEvent.click(await screen.findByText('View'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Candidate Person' })).toBeInTheDocument());
    expect(screen.queryByText('Log a Contact')).not.toBeInTheDocument();
  });
});
