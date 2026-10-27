import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PeopleTab } from '../components/admin/PeopleTab';
import { LeadersTab } from '../pages/AdminDashboardPage';
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
      body: { url: 'https://thegodnationacademy.org/member/password-help?token=abc123', expiresAt: '2026-10-23T12:00:00.000Z', kind: 'MEMBER', name: 'Prince N', whatsappNumber: '+237 670 000 111', language: 'fr' },
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

describe('Adding a person whose number is already there', () => {
  it('explains that deleting a registration or leader keeps the person, and shows them', async () => {
    mockFetch({
      'POST /api/admin/people': () => ({ status: 409, body: { error: 'A person with this WhatsApp number already exists.', code: 'NUMBER_EXISTS' } }),
      'GET /api/admin/people': () => ({ body: LIST }),
    });
    render(<PeopleTab includeTestData={false} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New Person' }));
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Prince N' } });
    fireEvent.change(screen.getByPlaceholderText(/WhatsApp number/), { target: { value: '+237 670 000 111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Person' }));
    expect(await screen.findByText(/does not remove the person behind it/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show the person with this number' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.url.includes('search=670000111'))).toBe(true));
    expect(screen.queryByText(/does not remove the person behind it/)).not.toBeInTheDocument();
  });
});

describe('Help them sign in — Leaders list', () => {
  const LEADER = { id: 'u9', name: 'Pastor Paul', email: 'paul@gmial.com', active: true, isTestData: false, selfRegistered: false, referralCode: 'PAUL1', referredCount: 3, createdAt: '2026-01-01T00:00:00Z', personId: null, personName: null };

  it('helps a leader who is not in People, with the email they sign in with', async () => {
    mockFetch({
      'GET /api/admin/leaders': () => ({ body: { items: [LEADER], pagination: { totalPages: 1 } } }),
      'POST /api/admin/leaders/u9/sign-in-help': () => ({
        body: { url: 'https://thegodnationacademy.org/reset-password?token=lead1', expiresAt: '2026-10-23T12:00:00.000Z', kind: 'LEADER', name: 'Pastor Paul', whatsappNumber: null, language: null, email: 'paul@gmial.com' },
      }),
    });
    render(<LeadersTab includeTestData={false} />);
    expect(await screen.findByText(/did they mean paul@gmail\.com/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Help them sign in' }));
    expect(screen.getByText('Help Pastor Paul sign in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make a sign-in link' }));
    expect(await screen.findByTestId('sign-in-help-url')).toHaveTextContent('/reset-password?token=lead1');
    expect(screen.getByText(/sign in on the leader page with paul@gmial\.com/)).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp will ask you whom to send it to/)).toBeInTheDocument();

    const href = screen.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')!;
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1])).toContain('leader account (paul@gmial.com)');
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

describe('A former leader who joined as a member', () => {
  it('shows the admin the member who joined with the leader\'s email and links them with one tap', async () => {
    let linked = false;
    mockFetch({
      'GET /api/admin/leaders': () => ({
        body: {
          items: [
            {
              id: 'lead7', name: 'Papa Former', email: 'papa@example.com', active: true, isTestData: false, selfRegistered: false,
              referralCode: 'OLD123', referredCount: 4, createdAt: '2026-01-01T00:00:00Z',
              personId: linked ? 'p9' : null, personName: linked ? 'Papa Former' : null,
              suggestedPerson: linked ? null : { id: 'p9', name: 'Papa Former', whatsappNumber: '+237 670 000 999' },
            },
          ],
          pagination: { totalPages: 1 },
        },
      }),
      'PATCH /api/admin/leaders/lead7/link-person': () => {
        linked = true;
        return { body: { id: 'lead7', personId: 'p9', personName: 'Papa Former' } };
      },
    });
    render(<LeadersTab includeTestData={false} />);
    const note = await screen.findByTestId('suggested-lead7');
    expect(note).toHaveTextContent('A member with this email has joined: Papa Former (+237 670 000 999)');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, link them' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ personId: 'p9' }));
    await waitFor(() => expect(screen.queryByTestId('suggested-lead7')).toBeNull());
  });
});
