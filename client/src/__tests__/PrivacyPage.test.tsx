import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { PrivacyPage } from '../pages/PrivacyPage';

// The public privacy policy Google Play requires: in both languages, naming
// what the app really uses, and pointing to deletion and contact.
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

function show() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ content: {} }) })));
  return render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
}

describe('Privacy policy', () => {
  it('lists what is collected, the services used, and how to delete an account', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1. What we collect' })).toBeInTheDocument();
    expect(screen.getByText(/Google Gemini is used to translate/)).toBeInTheDocument();
    expect(screen.getByText(/never receives private messages or prayer requests/)).toBeInTheDocument();
    expect(screen.getByText(/We do not sell your information/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Delete my account' })).toHaveAttribute('href', '/delete-account');
    expect(screen.getByRole('link', { name: 'Open the contact page' })).toHaveAttribute('href', '/contact');
  });

  it('is in French too, with every section', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Politique de confidentialité' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(10);
    expect(screen.getByText(/Nous ne vendons pas vos informations/)).toBeInTheDocument();
  });
});
