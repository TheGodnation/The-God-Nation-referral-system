import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import { MemberChatsPage } from '../pages/MemberChatsPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { ChatMessage } from '../components/chat/types';

// The central admin's member profile: one more sign-in step on a new
// phone, the "National Coordinator" badge, and every assembly in its chats.
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('Signing in to the National Coordinator’s profile on a new phone', () => {
  it('asks for the emailed code after the password, then signs in', async () => {
    let signedIn = false;
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: signedIn ? { name: 'Coordinator', email: 'c@x.com', preferredLanguage: 'en', personId: 'p1' } : null } }),
      'POST /api/member/auth/login': () => ({ body: { codeRequired: true } }),
      'POST /api/member/auth/verify-code': (b) => {
        signedIn = b.code === '123456';
        return signedIn ? { body: { member: { name: 'Coordinator' } } } : { status: 400, body: { code: 'BAD_CODE' } };
      },
    });
    render(
      <MemoryRouter initialEntries={['/member/login']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/login" element={<MemberLoginPage />} />
            <Route path="/member/chats" element={<p>Chats screen</p>} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'coord@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'GoodPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText(/this account needs one more step on a new phone: we sent a 6-digit code to coord@example.com/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(await screen.findByText('Chats screen')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/member/auth/verify-code')?.body).toEqual({ email: 'coord@example.com', code: '123456' });
  });
});

describe('The National Coordinator badge and assemblies', () => {
  it('shows the badge next to the name in an assembly chat', () => {
    const m = { id: 'm1', senderName: 'Pastor Ada', senderPersonId: 'p1', senderBadge: 'NATIONAL_COORDINATOR', isOwn: false, body: 'Teaching', createdAt: new Date().toISOString(), deleted: false, attachments: [] } as unknown as ChatMessage;
    render(
      <MemoryRouter>
        <MessageBubble m={m} mediaBase="/api/communities/g1/conversation" showSender highlighted={false} onReply={() => {}} onMenu={() => {}} onReact={() => {}} onJumpTo={() => {}} onOpenPhoto={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/National Coordinator/)).toBeInTheDocument();
  });

  it('lists the assemblies opened as National Coordinator in their own section', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: { name: 'Coordinator', personId: 'p1' } } }),
      'GET /api/member/me/community-memberships': () => ({
        body: {
          items: [
            { communityId: 'g1', communityName: 'Yaoundé assembly', status: 'ACTIVE' },
            { communityId: 'g2', communityName: 'Douala assembly', status: 'ACTIVE', asCoordinator: true },
          ],
        },
      }),
      'GET /api/communities/': () => ({ body: { unreadCount: 0, lastMessage: null } }),
      'GET /api/private-messages/conversations': () => ({ body: { items: [], total: 0 } }),
      'GET /api/me/announcements': () => ({ body: { items: [] } }),
      'GET /api/notifications': () => ({ body: { items: [], unreadCount: 0 } }),
    });
    render(
      <MemoryRouter>
        <MemberAuthProvider>
          <MemberChatsPage />
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/All assemblies — as National Coordinator/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Douala assembly')).toBeInTheDocument());
    expect(screen.getByText('Yaoundé assembly')).toBeInTheDocument();
  });
});
