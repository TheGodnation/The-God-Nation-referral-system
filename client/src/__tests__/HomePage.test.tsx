import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { HomePage } from '../pages/HomePage';

// The public front door: who we are, what we do, and how to join — with no
// trace of who referred the visitor.
describe('HomePage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: {}, youtubeUrl: 'https://youtube.com/@godnation' }),
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  const show = () =>
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

  it('introduces the ministry in a few short sections and points everyone to join', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A Digital Home for Kingdom Citizens');
    expect(screen.getByText(/exists to bring together citizens of the Kingdom of God/)).toBeInTheDocument();
    for (const name of ['More than a platform. A movement.', 'Everything you need to grow and make an impact.', 'Learn. Grow. Lead.', 'From Cameroon to Africa, and to the ends of the earth.']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    const joins = screen.getAllByRole('link', { name: /Join the Community/ });
    expect(joins.length).toBeGreaterThanOrEqual(3);
    for (const a of joins) expect(a).toHaveAttribute('href', '/member/join');
    for (const a of screen.getAllByRole('link', { name: /Existing Members — Sign In/ })) expect(a).toHaveAttribute('href', '/member/login');
  });

  it('has section links in the top bar, and is in French too', async () => {
    show();
    expect(screen.getByRole('link', { name: 'Our Vision' })).toHaveAttribute('href', '#vision');
    expect(screen.getByRole('link', { name: 'Global Mission' })).toHaveAttribute('href', '#mission');
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('citoyens du Royaume');
    expect(screen.getAllByRole('link', { name: /Rejoindre la communauté/ }).length).toBeGreaterThanOrEqual(3);
  });

  it('shows the social links the admin has set', async () => {
    show();
    expect(await screen.findByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://youtube.com/@godnation');
  });

  it('never shows referral or commission details', () => {
    show();
    expect(screen.queryByText(/500 FCFA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invited by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/referred by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/are you born again/i)).not.toBeInTheDocument();
  });
});
