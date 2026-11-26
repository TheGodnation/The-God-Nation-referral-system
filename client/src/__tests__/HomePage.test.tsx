import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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
    expect(screen.queryByText(/More than a platform/)).not.toBeInTheDocument();
    for (const name of ['Discover The God Nation', 'Learn. Grow. Lead.', 'From Cameroon to Africa, and to the ends of the earth.']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    const joins = screen.getAllByRole('link', { name: /Join the Community/ });
    expect(joins.length).toBeGreaterThanOrEqual(3);
    for (const a of joins) expect(a).toHaveAttribute('href', '/member/join');
    for (const a of screen.getAllByRole('link', { name: /Existing Members — Sign In/ })) expect(a).toHaveAttribute('href', '/member/login');
  });

  it('shows our motto right after the opening, as one statement', async () => {
    const { container } = show();
    const motto = screen.getByTestId('about-motto');
    expect(motto).toHaveTextContent('Our motto');
    expect(screen.getByTestId('about-motto-text').textContent).toBe(
      'Go into the digital media spaces where billions gather. Make disciples who make disciples, thereby taking the Gospel of the Kingdom to the ends of the earth.',
    );
    // After the hero, before "What we offer".
    const hero = container.querySelector('#top')!;
    const offer = container.querySelector('#offer')!;
    expect(hero.compareDocumentPosition(motto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(motto.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(await screen.findByText(/Allez dans les espaces des médias numériques/)).toBeInTheDocument();
  });

  it('shows ten "Discover The God Nation" slides after the motto and before the community section, in English and French, ending with the invitation to join', async () => {
    const { container } = show();
    const slides = screen.getByTestId('discover-slides');
    expect(slides.querySelectorAll('article')).toHaveLength(10);
    expect(screen.getByRole('heading', { level: 3, name: 'A Kingdom revival movement is emerging!' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Get trained. Get equipped. Get certified.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'You have a place. You have a role. Join the movement!' })).toBeInTheDocument();
    expect(screen.getByText('Reach. Train. Send. Multiply. Impact nations.')).toBeInTheDocument();
    // Order on the page: motto, then the slides, then "Real people…".
    const motto = screen.getByTestId('about-motto');
    expect(motto.compareDocumentPosition(slides) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slides.compareDocumentPosition(container.querySelector('#community')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The last slide carries only the two buttons the home page always has: join, and sign in. No WhatsApp button.
    const last = screen.getByTestId('discover-slide-12');
    expect(within(last).getByRole('link', { name: /Join the Community/ })).toHaveAttribute('href', '/member/join');
    expect(within(last).getByRole('link', { name: /Existing Members — Sign In/ })).toHaveAttribute('href', '/member/login');
    expect(within(last).queryByTestId('discover-whatsapp')).toBeNull();
    expect(within(last).getAllByRole('link')).toHaveLength(2);
    // Each photograph sits on the slide whose words it shows; slides 2 and 12 stay plain and bright. No book cover.
    expect(slides.querySelectorAll('article img[src^="/site/"]')).toHaveLength(10); // 9 photos, the whole one twice (itself + blurred behind)
    // Spiritual training and Discipleship are part of the Leadership Academy slide now, with the Academy's own photo.
    expect(screen.queryByTestId('discover-slide-2')).toBeNull();
    expect(screen.queryByTestId('discover-slide-10')).toBeNull();
    const academy = screen.getByTestId('discover-slide-3');
    expect(academy).toHaveTextContent('Leadership Academy');
    expect(academy).toHaveTextContent('16 structured e-books');
    expect(academy).toHaveTextContent('Learn. Share. Teach. Disciple others.');
    expect(academy).toHaveTextContent('After your training, join The God Nation team carrying the Gospel through modern media.');
    expect(academy).not.toHaveTextContent('/ 10'); // no slide numbers
    expect(screen.getByTestId('discover-whole-3')).toHaveAttribute('src', '/site/academy-collage.jpg'); // the four-picture Academy photo, whole
    expect(screen.getByTestId('discover-slide-7').querySelector('img[src="/site/skills-learning.jpg"]')).not.toBeNull();
    expect(screen.queryByText("Don't keep the Gospel to yourself.")).toBeNull();
    expect(screen.getByTestId('discover-slide-8').querySelector('img[src="/site/national-network.jpg"]')).not.toBeNull();
    expect(screen.getByTestId('discover-slide-9').querySelector('img[src="/site/mutual-support.jpg"]')).not.toBeNull();
    expect(slides.querySelector('img[src="/site/session-presenter.jpg"]')).toBeNull(); // the unclear photo is gone
    expect(screen.queryByTestId('discover-book')).toBeNull();
    // The first and last slide have no topic tag: no "The introduction", no "The invitation".
    expect(screen.queryByText('The introduction')).toBeNull();
    expect(screen.queryByText('The invitation')).toBeNull();
    expect(screen.queryByText('Spiritual training')).toBeNull();
    expect(screen.queryByText('Everything you need to grow and make an impact.')).toBeNull(); // the old heading above the slides is gone
    expect(screen.queryByText('What you can experience')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Un mouvement de réveil du Royaume émerge !' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Vous avez une place. Vous avez un rôle. Rejoignez le mouvement !' })).toBeInTheDocument();
  });

  it('has section links in the top bar, and is in French too', async () => {
    show();
    expect(screen.getByRole('link', { name: 'What We Offer' })).toHaveAttribute('href', '#offer');
    expect(screen.queryByRole('link', { name: 'Our Vision' })).not.toBeInTheDocument();
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
