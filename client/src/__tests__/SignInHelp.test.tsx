import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PeopleTab } from '../components/admin/PeopleTab';
import { MemberPasswordHelpPage } from '../pages/MemberPasswordHelpPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// "Help them sign in": the central admin makes a one-time link and sends it
// on WhatsApp; the member opens it and chooses a new password. Also the flag
// on a misspelled sign-in email.
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
      const res = key ? routes[key](body) : { status: 200, body: { items: [] } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const LIST = {
  items: [{ id: 'p1', name: 'Prince N', whatsappNumber: '+237 670 000 111', email: null, preferredLanguage: 'fr', _count: { communityMemberships: 0, registrations: 0 } }],
  pagination: { totalPages: 1 },
};

function detail(over: Record<string, unknown> = {}) {
  return {
    ...LIST.items[0],
    communityMemberships: [],
    registrations: [],
    users: [],
    memberAccount: { id: 'a1', email: 'prince@gmil.com', createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null },
    ...over,
  };
}

async function openPerson(d: ReturnType<typeof detail>) {
  mockFetch({
    'GET /api/admin/people/p1/': () => ({ body: { items: [], totalEligible: 0, completedCount: 0 } }),
    'GET /api/admin/people/p1': () => ({ body: d }),
    'GET /api/admin/people': () => ({ body: LIST }),
    'POST /api/admin/people/p1/sign-in-help': () => ({
      body: { url: 'https://thegodnationacademy.org/member/password-help?token=abc123', expiresAt: '2026-10-23T12:00:00.000Z', kind: 'MEMBER', name: 'Prince N', whatsappNumber: '+237 670 000 111' },
    }),
  });
  render(<PeopleTab includeTestData={false} />);
  fireEvent.click(await screen.findByText('View'));
}

describe('Help them sign in — admin', () => {
  it('makes the link and offers it on WhatsApp, in the person’s own language', async () => {
    await openPerson(detail());
    fireEvent.click(await screen.findByRole('button', { name: 'Make a sign-in link' }));
    expect(await screen.findByTestId('sign-in-help-url')).toHaveTextContent('/member/password-help?token=abc123');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/admin/people/p1/sign-in-help'))).toBe(true);

    const wa = screen.getByRole('link', { name: 'Send on WhatsApp' });
    const href = wa.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/237670000111?text=')).toBe(true);
    const text = decodeURIComponent(href.split('text=')[1]);
    expect(text).toContain('Bonjour Prince N');
    expect(text).toContain('https://thegodnationacademy.org/member/password-help?token=abc123');
  });

  it('flags a misspelled sign-in email and fills in the fix', async () => {
    await openPerson(detail());
    expect(await screen.findByText(/looks misspelled \(prince@gmil\.com\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use prince@gmail.com' }));
    expect(screen.getByDisplayValue('prince@gmail.com')).toBeInTheDocument();
  });

  it('offers no link for the central admin’s own profile', async () => {
    await openPerson(detail({ users: [{ id: 'u1', name: 'Admin', email: 'a@x.com', role: 'ADMIN' }] }));
    expect(await screen.findByText(/This is your own profile/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a sign-in link' })).not.toBeInTheDocument();
  });
});

function renderPage(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/member/password-help?token=${token}`]}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/password-help" element={<MemberPasswordHelpPage />} />
          <Route path="/member/chats" element={<p>Chats</p>} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Help them sign in — the member’s page', () => {
  it('chooses a new password and signs in', async () => {
    mockFetch({
      'GET /api/settings': () => ({ status: 404, body: {} }),
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'GET /api/member/auth/password-help': () => ({ body: { name: 'Prince N', email: 'prince@gmail.com' } }),
      'POST /api/member/auth/password-help': () => ({ body: { member: { name: 'Prince N', email: 'prince@gmail.com', preferredLanguage: 'en' } } }),
    });
    renderPage('abc123');
    expect(await screen.findByText(/Hello Prince N/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass123' } });
    fireEvent.change(screen.getByLabelText('Type the new password again'), { target: { value: 'NewPass124' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(await screen.findByText('The two passwords are not the same.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/password-help'))).toBe(false);

    fireEvent.change(screen.getByLabelText('Type the new password again'), { target: { value: 'NewPass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(await screen.findByText(/Your new password is saved/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/password-help'));
    expect(post?.body).toEqual({ token: 'abc123', newPassword: 'NewPass123' });
  });

  it('says when the link has expired or was used', async () => {
    mockFetch({
      'GET /api/settings': () => ({ status: 404, body: {} }),
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'GET /api/member/auth/password-help': () => ({ status: 400, body: { error: 'expired', code: 'BAD_LINK' } }),
    });
    renderPage('old');
    expect(await screen.findByText(/This link has expired or was already used/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
  });
});
