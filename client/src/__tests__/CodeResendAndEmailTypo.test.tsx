import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { suggestEmailFix } from '../lib/emailTypo';

// Codes on a slow connection: "Send a new code" waits a minute after each
// email, and a misspelled email provider (gmil.com…) is caught before any
// code is sent to an address that does not exist.
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
      const res = key ? routes[key](body) : { status: 200, body: { content: {}, supportWhatsappUrl: null } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  calls.length = 0;
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/member/login']}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/login" element={<MemberLoginPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

const codeRequests = () => calls.filter((c) => c.url === '/api/member/auth/request-code').length;
const signupStarts = () => calls.filter((c) => c.url === '/api/member/auth/signup/start').length;

describe('"Send a new code" waits a minute', () => {
  it('on the sign-in code screen: counts down, then allows one new code and waits again', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'POST /api/member/auth/request-code': () => ({ body: { message: 'ok' } }),
    });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password, or never set one?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await screen.findByLabelText('6-digit code');
    expect(screen.getByText(/On a slow connection the email can take a few minutes/)).toBeInTheDocument();

    // Only the clock is faked: the real once-a-second tick then reads it.
    vi.useFakeTimers({ toFake: ['Date'] });
    const waiting = screen.getByRole('button', { name: /Send a new code in \d+s/ });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    expect(codeRequests()).toBe(1);

    vi.setSystemTime(Date.now() + 61_000);
    const resend = await screen.findByRole('button', { name: 'Send a new code' }, { timeout: 2500 });
    expect(resend).toBeEnabled();
    await act(async () => {
      fireEvent.click(resend);
    });
    expect(codeRequests()).toBe(2);
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();
  });

  it('on the join flow code screen too', async () => {
    mockFetch({ 'POST /api/member/auth/signup/start': () => ({ body: { message: 'ok' } }) });
    render(
      <MemoryRouter initialEntries={['/register?pathway=TRAINING']}>
        <RegisterPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('6-digit code');

    // Only the clock is faked: the real once-a-second tick then reads it.
    vi.useFakeTimers({ toFake: ['Date'] });
    expect(screen.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();
    vi.setSystemTime(Date.now() + 61_000);
    const resend = await screen.findByRole('button', { name: 'Resend code' }, { timeout: 2500 });
    await act(async () => {
      fireEvent.click(resend);
    });
    expect(signupStarts()).toBe(2);
    expect(screen.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();
  });
});

describe('"Did you mean …?" for a misspelled email provider', () => {
  it('suggests the real provider for common slips, and leaves good addresses alone', () => {
    expect(suggestEmailFix('princenjikang99@gmil.com')).toBe('princenjikang99@gmail.com');
    expect(suggestEmailFix('a@gmal.com')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@gnail.com')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@gmail.co')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@gmailcom')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@gmail.fr')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@yahooo.fr')).toBe('a@yahoo.fr');
    expect(suggestEmailFix('a@yaho.com')).toBe('a@yahoo.com');
    expect(suggestEmailFix('a@hotmial.com')).toBe('a@hotmail.com');
    expect(suggestEmailFix(' Ada.N@GMIL.COM ')).toBe('Ada.N@gmail.com');
    expect(suggestEmailFix('a@gmail')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@gmial')).toBe('a@gmail.com');
    expect(suggestEmailFix('a@yahoo')).toBe('a@yahoo.com');
    expect(suggestEmailFix('a@gmail.com.')).toBe('a@gmail.com');

    for (const ok of ['a@gmail.com', 'a@yahoo.fr', 'a@mail.com', 'a@live.fr', 'a@thegodnationacademy.org', 'a@orange.cm', 'a@gmx.com', 'not-an-email', 'a@', 'a@localhost', 'a@church']) {
      expect(suggestEmailFix(ok)).toBeNull();
    }
  });

  it('on the join flow: stops before sending, and "Yes, use this" fixes the address', async () => {
    mockFetch({ 'POST /api/member/auth/signup/start': () => ({ body: { message: 'ok' } }) });
    render(
      <MemoryRouter initialEntries={['/register?pathway=TRAINING']}>
        <RegisterPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@gmil.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Did you mean ada@gmail.com?')).toBeInTheDocument();
    expect(signupStarts()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, use this' }));
    expect(screen.getByLabelText('Email')).toHaveValue('ada@gmail.com');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('6-digit code');
    expect(calls.find((c) => c.url === '/api/member/auth/signup/start')?.body.email).toBe('ada@gmail.com');
  });

  it('"No, keep mine" sends the address as typed', async () => {
    mockFetch({ 'POST /api/member/auth/signup/start': () => ({ body: { message: 'ok' } }) });
    render(
      <MemoryRouter initialEntries={['/register?pathway=TRAINING']}>
        <RegisterPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@gmal.com' } });
    fireEvent.blur(screen.getByLabelText('Email'));
    expect(screen.getByText('Did you mean ada@gmail.com?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No, keep mine' }));
    expect(screen.queryByText('Did you mean ada@gmail.com?')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('6-digit code');
    expect(calls.find((c) => c.url === '/api/member/auth/signup/start')?.body.email).toBe('ada@gmal.com');
  });

  it('on "forgot password": no code is requested for a misspelled address until the visitor answers', () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: { member: null } }),
      'POST /api/member/auth/request-code': () => ({ body: { message: 'ok' } }),
    });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password, or never set one?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@gnail.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(screen.getByText('Did you mean ada@gmail.com?')).toBeInTheDocument();
    expect(codeRequests()).toBe(0);
  });
});
