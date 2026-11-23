import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import i18n from '../i18n';

// "Continue with Google" on the sign-in page: hidden until Google sign-in is set up, then it signs the member in.
let clientId: string | null = null;
let credentialCallback: ((r: { credential?: string }) => void) | null = null;
let googleResponse: { status: number; body: unknown } = { status: 200, body: { member: { name: 'Ada', email: 'ada@example.com', preferredLanguage: 'en' } } };
let joinResponse: { status: number; body: unknown } = { status: 200, body: {} };
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
      else if (url === '/api/member/auth/google/join') ({ status, body } = joinResponse);
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
    // It is an extra way in, below the email and password form, set apart by a small "or".
    const form = document.querySelector('form')!;
    expect(form.compareDocumentPosition(screen.getByTestId('google-signin')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('google-or')).toHaveTextContent('or');
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    await act(async () => credentialCallback!({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/member/auth/google')?.body).toEqual({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    expect(await screen.findByText('the chats')).toBeInTheDocument();
  });

  it('lets someone with no member account join with Google, with no code and no password', async () => {
    googleResponse = { status: 404, body: { error: 'none', code: 'NO_ACCOUNT', email: 'new@example.com' } };
    show();
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    const payload = btoa(JSON.stringify({ email: 'new@example.com' })).replace(/=+$/, '');
    await act(async () => credentialCallback!({ credential: `aaaa.${payload}.zzzzzzzzzzzzzzzz` }));
    expect(await screen.findByTestId('google-join')).toHaveTextContent('new@example.com');
    // The Terms box is required.
    fireEvent.change(within(screen.getByTestId('google-join')).getByRole('textbox'), { target: { value: '677123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('accept the Terms');
    expect(calls.some((c) => c.url === '/api/member/auth/google/join')).toBe(false);
    joinResponse = { status: 200, body: { member: { name: 'new@example.com', email: 'new@example.com', preferredLanguage: 'en' } } };
    fireEvent.click(within(screen.getByTestId('google-join-terms')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Join with Google' }));
    expect(await screen.findByText('the chats')).toBeInTheDocument();
    const sent = calls.find((c) => c.url === '/api/member/auth/google/join')?.body;
    expect(sent).toMatchObject({ acceptTerms: true, consentWhatsapp: false, consentEmail: false });
    expect(sent.credential).toContain('zzzzzzzz');
    expect(sent.whatsapp).toBeTruthy();
  });

  it('says so when a person who just joined already has an account', async () => {
    googleResponse = { status: 404, body: { error: 'none', code: 'NO_ACCOUNT' } };
    joinResponse = { status: 409, body: { error: 'x', code: 'ACCOUNT_EXISTS' } };
    show();
    await waitFor(() => expect(credentialCallback).not.toBeNull());
    await act(async () => credentialCallback!({ credential: 'signed.token.value-from-google-aaaaaaaa' }));
    await screen.findByTestId('google-join');
    fireEvent.change(within(screen.getByTestId('google-join')).getByRole('textbox'), { target: { value: '677123456' } });
    fireEvent.click(within(screen.getByTestId('google-join-terms')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Join with Google' }));
    expect(await screen.findByText(/already have an account/)).toBeInTheDocument();
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
