import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberDeleteAccountPage } from '../pages/MemberDeleteAccountPage';
import { DeleteAccountPage } from '../pages/DeleteAccountPage';
import { AccountDeletionsTab } from '../components/admin/AccountDeletionsTab';
import { WelcomeBackBanner } from '../components/member/WelcomeBackBanner';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { noteSignIn } from '../lib/accountDeletion';

// "Delete my account": the warning, the password and "I understand", the
// month to change one's mind; the public web page with an emailed code;
// "Welcome back" after signing in again; the central admin's decisions.
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
  vi.restoreAllMocks();
  calls.length = 0;
  sessionStorage.clear();
});

let signedIn = true;
const ME = () => ({ member: signedIn ? { name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'p1', profileComplete: true } : null });
const READY = '2026-11-21T10:00:00.000Z';

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/delete-account" element={<MemberDeleteAccountPage />} />
          <Route path="/delete-account" element={<DeleteAccountPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Delete my account, in the app', () => {
  it('warns that everything will be lost, needs "I understand" and the password, then shows the date', async () => {
    signedIn = true;
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME() }),
      'POST /api/member/account/delete': (b) => {
        if (b.password !== 'GoodPass123!') return { status: 401, body: { error: 'x', code: 'WRONG_PASSWORD' } };
        signedIn = false;
        return { body: { readyAt: READY, days: 30 } };
      },
    });
    renderApp('/member/delete-account');
    expect(await screen.findByText(/If you delete your account, everything will be lost:/)).toBeInTheDocument();
    expect(screen.getByText(/in chats they will show as “This message was deleted”/)).toBeInTheDocument();
    expect(screen.getByText(/that role goes back to the central admin/)).toBeInTheDocument();
    expect(screen.getByText(/Changed your mind\? Just sign in again before then/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please tick “I understand” first.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByLabelText('I understand that everything will be lost.'));
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('That password is not right.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'GoodPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Your account is now hidden.')).toBeInTheDocument();
    expect(screen.getByText(/It will be deleted after 21 November 2026/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').pop()?.body).toEqual({ password: 'GoodPass123!', confirm: true });
  });
});

describe('The public "Delete your account" page', () => {
  it('explains how, then deletes with the code emailed to the account', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'GET /api/auth/me': () => ({ status: 401, body: {} }),
      'POST /api/account-deletion/request-code': () => ({ body: { message: 'ok' } }),
      'POST /api/account-deletion/confirm': (b) => (b.code === '123456' ? { body: { readyAt: READY, days: 30 } } : { status: 400, body: { code: 'BAD_CODE' } }),
    });
    renderApp('/delete-account');
    expect(await screen.findByRole('heading', { name: 'Delete your The God Nation account' })).toBeInTheDocument();
    expect(screen.getByText(/Me → Edit profile → Delete my account/)).toBeInTheDocument();
    expect(screen.getByText(/without your name/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('The email address you sign in with'), { target: { value: 'mary@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByText(/If mary@example.com belongs to an account/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByLabelText('I understand that everything will be lost.'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Your account is now hidden.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/confirm') && c.body.code === '123456')?.body).toEqual({ email: 'mary@example.com', code: '123456' });
  });
});

describe('Coming back', () => {
  it('greets the member once after a sign-in that cancelled the deletion', () => {
    noteSignIn({ member: {}, deletionCancelled: true });
    const first = render(<WelcomeBackBanner />);
    expect(screen.getByText(/Welcome back! Your account was not deleted/)).toBeInTheDocument();
    first.unmount();
    render(<WelcomeBackBanner />);
    expect(screen.queryByText(/Welcome back!/)).not.toBeInTheDocument();
    noteSignIn({ member: {} });
  });
});

describe('Account deletions (central admin)', () => {
  it('lists who asked, the roles that came back, and deletes only after the month', async () => {
    let items = [
      { id: 'r1', name: 'Mary Ngu', email: 'm@x.com', whatsappNumber: '+237670000001', source: 'APP', requestedAt: '2026-10-21T10:00:00Z', readyAt: READY, ready: false, returnedRoles: ['Leader of Yaoundé Youth'] },
      { id: 'r2', name: 'Paul', email: 'p@x.com', whatsappNumber: '+237670000002', source: 'WEB', requestedAt: '2026-09-01T10:00:00Z', readyAt: '2026-10-01T10:00:00Z', ready: true, returnedRoles: [] },
    ];
    mockFetch({
      'GET /api/admin/account-deletions': () => ({ body: { items, closed: [{ id: 'c1', status: 'COMPLETED', requestedAt: '2026-08-01T00:00:00Z', completedAt: '2026-09-05T00:00:00Z', cancelledAt: null, cancelledBy: null }] } }),
      'POST /api/admin/account-deletions/r1': () => {
        items = items.filter((i) => i.id !== 'r1');
        return { body: { ok: true } };
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountDeletionsTab />);
    expect(await screen.findByText('Mary Ngu')).toBeInTheDocument();
    expect(screen.getByText(/Came back to you: Leader of Yaoundé Youth/)).toBeInTheDocument();
    expect(screen.getByText(/on the website/)).toBeInTheDocument();
    expect(screen.getByText(/An account was deleted on/)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete for good' });
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).toBeEnabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Keep the account' })[0]);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'KEEP' }));
    await waitFor(() => expect(screen.queryByText('Mary Ngu')).not.toBeInTheDocument());
  });
});
