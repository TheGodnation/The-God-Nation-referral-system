import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberLoginPage } from '../pages/MemberLoginPage';
import i18n from '../i18n';

// The "continue where you stopped" link: the sign-in page says the person is already registered and starts on the emailed-code step.
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({}) })));
});
afterEach(() => vi.unstubAllGlobals());

const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><MemberLoginPage /></MemoryRouter>);

describe('Continue where you stopped', () => {
  it('shows a welcome-back note and the email-code step (no password form)', () => {
    show('/member/login?continue=1');
    expect(screen.getByTestId('continue-banner')).toHaveTextContent('You are already registered');
    expect(screen.queryByLabelText(/^Password/i)).toBeNull();
  });

  it('the ordinary sign-in page is unchanged', () => {
    show('/member/login');
    expect(screen.queryByTestId('continue-banner')).toBeNull();
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    show('/member/login?continue=1&lang=fr');
    expect(screen.getByTestId('continue-banner')).toHaveTextContent('Vous êtes déjà inscrit(e)');
  });
});
