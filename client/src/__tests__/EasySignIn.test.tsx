import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import { MemberNav } from '../components/member/MemberNav';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes).find((k) => {
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

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/member/login']}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/login" element={<MemberLoginPage />} />
          <Route path="/member/chats" element={<p>Chats screen</p>} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Sign in with email and a 6-digit code', () => {
  it('asks only for email, then for the code, then opens Chats', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'POST /api/member/auth/request-code': () => ({ body: { message: 'ok' } }),
      'POST /api/member/auth/verify-code': () => ({ body: { member: { name: 'A' } } }),
    });
    renderLogin();
    expect(screen.queryByLabelText(/WhatsApp/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));

    expect(await screen.findByText('We sent a 6-digit code to ada@example.com. Type it below.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12 34 56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Chats screen')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/member/auth/verify-code')?.body).toEqual({ email: 'ada@example.com', code: '123456' });
  });

  it('explains a wrong code', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'POST /api/member/auth/request-code': () => ({ body: { message: 'ok' } }),
      'POST /api/member/auth/verify-code': () => ({ status: 400, body: { error: 'x', code: 'BAD_CODE' } }),
    });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That code is not right or has expired.'),
    );
  });
});

describe('Bottom bar', () => {
  it('shows the five WhatsApp-style tabs', () => {
    render(
      <MemoryRouter initialEntries={['/member/chats']}>
        <MemberNav />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Chats', '/member/chats'],
      ['Updates', '/member/updates'],
      ['Learn', '/member/learn'],
      ['People', '/member/people'],
      ['Me', '/member/me'],
    ]);
  });
});
