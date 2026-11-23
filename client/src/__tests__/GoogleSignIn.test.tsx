import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import i18n from '../i18n';

// "Continue with Google" on the sign-in page: hidden until Google sign-in is set up, then it signs the member in.
let clientId: string | null = null;
let credentialCallback: ((r: { credential?: string }) => void) | null = null;
let googleResponse: { status: number; body: unknown } = { status: 200, body: { member: { name: 'Ada', email: 'ada@example.com', preferredLanguage: 'en' } } };
const calls: { url: string; method: string; body: any }[] = [];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  clientId = 'cid-123.apps.googleusercontent.com';
  credentialCallback = null;
  googleResponse = { status: 200, body: { member: { name: 'Ada', email: 'ada@example.com', preferredLanguage: 'en' } } };
  const rendered: HTMLElement[] = [];
  (window as any).google = {
    accounts: {
      id: {
        initialize: (cfg: { callback: (r: { credential?: string }) => void }) => {
          credentialCallback = cfg.callback;
        },
        renderButton: (el: HTMLElement) => {
          rendered.push(el);
          el.innerHTML = '<button type="button">Continue with Google</button>';
        },
      },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      let status = 200;
      let body: unknown = {};
      if (url === '/api/member/auth/google-config') body = { clientId };
      else if (url === '/api/member/auth/google') ({ status, body } = googleResponse);
      else if (url === '/api/member/auth/me') body = { member: { name: 'Ada', email: 'ada@example.com' } };
      else status = 404;
      return { ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).google;
  calls.length = 0;
});

const show = () =>
  render(
    <MemoryRouter initialEntries={['/member/login']}>
      <Routes>
        <Route path="/member/login" element={<MemberLoginPage />} />
        <Route path="/member/chats" element={<p>the chats</p>} />
        <Route path="/member/join" element={<p>join page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Continue with Google', () => {
  it('shows nothing until Google sign-in is set up', async () => {
    clientId = null;
    show();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/member/auth/google-config')).toBe(true));
    expect(screen.queryByTestId('google-signin')).toBeNull();
  });

  it('shows Google’s button once set up, and sends the signed token to the server when it is used', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    await act(async () => credentialCallback!({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/member/auth/google')?.body).toEqual({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    expect(await screen.findByText('the chats')).toBeInTheDocument();
  });

  it('tells someone with no member account to join first', async () => {
    googleResponse = { status: 404, body: { error: 'none', code: 'NO_ACCOUNT' } };
    show();
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    await act(async () => credentialCallback!({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    expect(await screen.findByTestId('google-no-account')).toHaveTextContent('No member account uses this Google email yet');
  });

  it('asks the central admin’s profile for the emailed code on a new phone', async () => {
    googleResponse = { status: 200, body: { codeRequired: true, email: 'boss@example.com' } };
    show();
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    await act(async () => credentialCallback!({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    expect((await screen.findAllByText(/boss@example.com/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('the chats')).toBeNull();
  });

  it('says so when Google sign-in did not work', async () => {
    googleResponse = { status: 401, body: { error: 'bad', code: 'BAD_GOOGLE' } };
    show();
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    await act(async () => credentialCallback!({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in did not work');
  });
});
