import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadersOversight } from '../components/admin/LeadersOversight';

// The central admin's drill-down: each leader with their people, and a
// read-only look at the follow-up chats (switch-off included).
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(handlers: Record<string, () => { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      const res = key ? handlers[key]() : { status: 404, body: { error: 'nope' } };
      return Promise.resolve({ ok: res.status < 300, status: res.status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const BASE = '/api/admin/cells';
const leaders = { items: [{ personId: 'l1', name: 'Charlie', away: false, people: 12, contactedTwice: 9, needingAttention: 3, emergencies: 1 }] };

describe('LeadersOversight', () => {
  it('lists the leaders with their numbers, then a leader\'s chats, then one whole conversation', async () => {
    mockFetch({
      [`${BASE}/health/a1/leaders`]: () => ({ status: 200, body: leaders }),
      [`${BASE}/oversight/settings`]: () => ({ status: 200, body: { enabled: true } }),
      [`${BASE}/oversight/leaders/l1/chats`]: () => ({ status: 200, body: { items: [{ conversationId: 'c1', memberName: 'Mia', messageCount: 2, lastMessageAt: '2026-11-01T10:00:00Z', lastFrom: 'MEMBER' }] } }),
      [`${BASE}/oversight/chats/c1`]: () => ({
        status: 200,
        body: {
          leaderName: 'Charlie',
          memberName: 'Mia',
          messages: [
            { id: 'm1', from: 'LEADER', senderName: 'Charlie', body: 'How are you?', createdAt: '2026-11-01T09:00:00Z', removed: false, attachments: [] },
            { id: 'm2', from: 'MEMBER', senderName: 'Mia', body: '', createdAt: '2026-11-01T10:00:00Z', removed: false, attachments: [{ kind: 'VOICE', fileName: 'voice.m4a' }] },
          ],
        },
      }),
    });
    render(<LeadersOversight base={BASE} communityId="a1" />);
    expect(await screen.findByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText(/12 people · 9 in touch twice this week · 3 need attention/)).toBeInTheDocument();
    expect(screen.getByText('1 emergency')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Read chats' }));
    fireEvent.click(await screen.findByText('Mia'));
    expect(await screen.findByText('How are you?')).toBeInTheDocument();
    expect(screen.getByText(/Voice note: voice.m4a/)).toBeInTheDocument();
    // Read-only: no way to write anything here.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('can be switched off, and then the chats cannot be opened', async () => {
    let enabled = true;
    mockFetch({
      [`${BASE}/health/a1/leaders`]: () => ({ status: 200, body: leaders }),
      [`${BASE}/oversight/settings`]: () => ({ status: 200, body: { enabled } }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        let body: unknown = leaders;
        if (url.includes('/oversight/settings')) {
          if (method === 'PUT') enabled = JSON.parse(init!.body as string).enabled;
          body = { enabled };
        }
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
      }),
    );
    render(<LeadersOversight base={BASE} communityId="a1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(screen.getByText('Reading follow-up chats is switched off.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Read chats' })).not.toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: false });
  });
});
