import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { TermsPage } from '../pages/TermsPage';

// The public rules for using the app: in both languages, with the community rules, what happens when
// they are broken, and the links to contact and to the privacy policy.
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

function show() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ content: {} }) })));
  return render(<MemoryRouter><TermsPage /></MemoryRouter>);
}

describe('Terms of Use', () => {
  it('states the community rules, the sanctions, the content and payment rules, and links to contact and privacy', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3. The rules of our community' })).toBeInTheDocument();
    expect(screen.getByText(/Insult, mock, threaten, harass, bully or humiliate anyone/)).toBeInTheDocument();
    expect(screen.getByText(/Ask other members for money, gifts or personal favours/)).toBeInTheDocument();
    expect(screen.getByText(/Share other people’s private matters/)).toBeInTheDocument();
    expect(screen.getByText(/muted for 3, 7, 15 or 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/Only the central team can remove a member from the community for good/)).toBeInTheDocument();
    expect(screen.getByText(/not an accredited academic degree/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('link', { name: 'Read our Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  it('is in French too, with every section', async () => {
    show();
    const english = screen.getAllByRole('heading', { level: 2 }).length;
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Conditions d’utilisation' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(english);
    expect(screen.getByText(/Insulter, moquer, menacer, harceler, intimider ou humilier/)).toBeInTheDocument();
    expect(screen.getByText(/rendu muet pour 3, 7, 15 ou 30 jours/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lire notre politique de confidentialité' })).toHaveAttribute('href', '/privacy');
  });
});
