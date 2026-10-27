import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { LeaderSetupPage } from '../pages/LeaderSetupPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { SignInHelpPanel } from '../components/admin/SignInHelpCard';
import { AuthProvider } from '../lib/AuthContext';

// The pages behind the "choose your password" links are in English and French,
// and the admin's link opens in the language chosen for the message.
function mockFetch(handler: (url: string, method: string) => { status?: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const res = handler(url, init?.method ?? 'GET');
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

const at = (ui: React.ReactElement, path: string) => render(<MemoryRouter initialEntries={[path]}><AuthProvider>{ui}</AuthProvider></MemoryRouter>);

describe('Password link pages', () => {
  it('the reset page is in French for a French reader, and the language buttons switch it', async () => {
    mockFetch(() => ({ body: { content: {} } }));
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    at(<ResetPasswordPage />, '/reset-password?token=abc');
    expect(screen.getByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nouveau mot de passe')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { name: 'Reset Password' })).toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeInTheDocument();
  });

  it('the reset page explains a bad link in the reader\'s language', async () => {
    mockFetch((url) => (url.includes('reset-password') ? { status: 400, body: { error: 'x', code: 'BAD_LINK' } } : { body: { content: {} } }));
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    at(<ResetPasswordPage />, '/reset-password?token=abc');
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'NewPass123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'NewPass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser le mot de passe' }));
    expect(await screen.findByText(/invalide ou a expiré/)).toBeInTheDocument();
  });

  it('the leader setup and forgot-password pages are translated too', async () => {
    mockFetch(() => ({ body: { content: {} } }));
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    const a = at(<LeaderSetupPage />, '/leader/setup?token=t');
    expect(screen.getByRole('heading', { name: 'Choisissez votre mot de passe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activer mon compte' })).toBeInTheDocument();
    a.unmount();
    at(<ForgotPasswordPage />, '/forgot-password');
    expect(screen.getByRole('heading', { name: 'Mot de passe oublié' })).toBeInTheDocument();
  });
});

describe('The admin\'s sign-in link', () => {
  it('opens the page in the language chosen for the WhatsApp message', async () => {
    mockFetch(() => ({
      body: { url: 'https://thegodnationacademy.org/member/password-help?token=abc', expiresAt: '2026-10-30T12:00:00.000Z', kind: 'MEMBER', name: 'Prince', whatsappNumber: '237650000000', language: 'fr' },
    }));
    render(<SignInHelpPanel endpoint="/api/admin/people/p1/sign-in-help" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make a sign-in link' }));
    expect(await screen.findByTestId('sign-in-help-url')).toHaveTextContent('password-help?token=abc&lang=fr');
    const frHref = screen.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')!;
    expect(decodeURIComponent(frHref.split('text=')[1])).toMatch(/Bonjour Prince.*password-help\?token=abc&lang=fr/s);

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByTestId('sign-in-help-url')).toHaveTextContent('&lang=en');
    const enHref = screen.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href')!;
    expect(decodeURIComponent(enHref.split('text=')[1])).toMatch(/Hello Prince.*&lang=en/s);
  });
});

describe('A person with no account yet', () => {
  it('lets the admin give the email they will sign in with, and opens the account', async () => {
    const posts: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posts.push(JSON.parse(init.body as string));
        const body = init?.method === 'POST'
          ? { url: 'https://thegodnationacademy.org/member/password-help?token=zzz', expiresAt: '2026-10-30T12:00:00.000Z', kind: 'MEMBER', name: 'Brother Paul', whatsappNumber: '237650000000', language: 'en' }
          : { content: {} };
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
      }),
    );
    render(<SignInHelpPanel endpoint="/api/admin/people/p9/sign-in-help" askEmail="" />);
    const make = screen.getByRole('button', { name: 'Open the account and make a sign-in link' });
    expect(make).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Email they will sign in with'), { target: { value: 'paul@example.com' } });
    fireEvent.click(make);
    expect(await screen.findByTestId('sign-in-help-url')).toHaveTextContent('password-help?token=zzz');
    expect(posts).toEqual([{ email: 'paul@example.com' }]);
  });
});
