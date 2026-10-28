import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import { PageShell } from '../components/PageShell';
import { AuthProvider } from '../lib/AuthContext';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// Someone already signed in who opens the public address (taps the logo,
// types the website, opens a bookmark) goes straight into the app.
function mockApi(who: { member?: object | null; user?: object | null }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.startsWith('/api/member/auth/me')
        ? { member: who.member ?? null }
        : url.startsWith('/api/auth/me')
          ? { user: who.user ?? null }
          : { content: {}, items: [] };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const MEMBER = { name: 'Ann', email: 'ann@example.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'p1', profileComplete: true };

function app(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <MemberAuthProvider>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/member/login" element={<MemberLoginPage />} />
            <Route path="/member/chats" element={<p>Inside the app</p>} />
            <Route path="/admin/dashboard" element={<p>Admin dashboard</p>} />
            <Route path="/leader/dashboard" element={<p>Leader dashboard</p>} />
            <Route path="/teachings" element={<PageShell><p>Teachings page</p></PageShell>} />
          </Routes>
        </MemberAuthProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Already signed in', () => {
  it('a member who opens the public home page goes straight into the app', async () => {
    mockApi({ member: MEMBER });
    app('/');
    expect(await screen.findByText('Inside the app')).toBeInTheDocument();
  });

  it('a member on the sign-in page is taken into the app too', async () => {
    mockApi({ member: MEMBER });
    app('/member/login');
    expect(await screen.findByText('Inside the app')).toBeInTheDocument();
  });

  it('a leader goes to the leader dashboard and the central admin to the admin dashboard', async () => {
    mockApi({ user: { id: 'u1', name: 'Paul', email: 'p@x.com', role: 'LEADER' } });
    app('/');
    expect(await screen.findByText('Leader dashboard')).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({ user: { id: 'u2', name: 'Admin', email: 'a@x.com', role: 'ADMIN' } });
    app('/');
    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
  });

  it('a visitor who is not signed in sees the home page and the sign-in form as before', async () => {
    mockApi({});
    app('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('A Digital Home for Kingdom Citizens');
  });

  it('on the public pages a signed-in member gets "Open the app" instead of "Member Login", and the logo goes into the app', async () => {
    mockApi({ member: MEMBER });
    app('/teachings');
    const links = await screen.findAllByRole('link', { name: 'Open the app' });
    for (const a of links) expect(a).toHaveAttribute('href', '/member/chats');
    expect(screen.queryByRole('link', { name: 'Member Login' })).toBeNull();
    expect(screen.getByRole('link', { name: /THE GOD NATION/ })).toHaveAttribute('href', '/member/chats');
  });
});
