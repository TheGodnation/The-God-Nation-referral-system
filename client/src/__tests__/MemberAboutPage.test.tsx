import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAboutPage } from '../pages/MemberAboutPage';
import { HomeAboutTabs } from '../components/member/HomeAboutTabs';

function mockFetch(settings: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => (url.startsWith('/api/settings/public') ? settings : { items: [], unreadCount: 0 }),
      }),
    ),
  );
}
afterEach(() => vi.unstubAllGlobals());

const renderAbout = () =>
  render(
    <MemoryRouter initialEntries={['/member/about']}>
      <Routes>
        <Route path="/member/about" element={<MemberAboutPage />} />
        <Route path="/member/updates" element={<div>The Home page</div>} />
        <Route path="/member/leadership" element={<div>The leaders page</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('About the God Nation', () => {
  it('shows the academy\'s own text: who we are, our calling, one blended vision and mission, and the motto', async () => {
    mockFetch({ content: {} });
    renderAbout();
    expect(await screen.findByRole('heading', { name: 'Who we are' })).toBeInTheDocument();
    expect(screen.getByText(/exists to bring together citizens of the Kingdom of God/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our calling' })).toBeInTheDocument();
    expect(screen.getByText(/many years of personal encounters with Christ/)).toBeInTheDocument();
    // The vision continues, with the mission's words blended into it; there is no separate "Our mission".
    expect(screen.getByRole('heading', { name: 'Our vision in action' })).toBeInTheDocument();
    expect(screen.getByText(/modern media provides an unprecedented opportunity/)).toBeInTheDocument();
    expect(screen.getByText(/to gather, train, equip, and mobilize citizens of the Kingdom of God/)).toBeInTheDocument();
    expect(screen.getByText(/From Cameroon to Africa and to the ends of the earth, we are preparing and mobilizing them/)).toBeInTheDocument();
    expect(screen.getByText(/We are not simply building a media team/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Our mission' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Our vision and mission' })).toBeNull();
  });

  it('says just "The God Nation" — in the blue heading and in "Who we are" — never the long name', async () => {
    mockFetch({ content: {} });
    const { container } = renderAbout();
    await screen.findByRole('heading', { name: 'Who we are' });
    const header = container.querySelector('header.rounded-xl')!;
    expect(within(header as HTMLElement).getByRole('heading', { name: 'The God Nation' })).toBeInTheDocument();
    expect(screen.getByText(/^The God Nation exists to bring together citizens of the Kingdom of God/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Media and Leadership Academy/);
  });

  it('states the motto as one statement, set apart in gold, with its call to go in bold capitals', async () => {
    mockFetch({ content: {} });
    renderAbout();
    const motto = await screen.findByTestId('about-motto');
    expect(within(motto).getByRole('heading', { name: 'Our motto' })).toBeInTheDocument();
    // One statement in one block.
    const text = within(motto).getByTestId('about-motto-text');
    expect(text.textContent).toBe('Go into the digital media spaces where billions gather. Make disciples who make disciples, thereby taking the Gospel of the Kingdom to the ends of the earth.');
    expect(text.tagName).toBe('P');
    expect(motto.querySelectorAll('p')).toHaveLength(1);
    // The opening call is in capitals and bold; the rest flows on in italic.
    const lead = within(text).getByText('Go into the digital media spaces where billions gather.');
    expect(lead.className).toMatch(/uppercase/);
    expect(lead.className).toMatch(/font-bold/);
    expect(within(text).getByText(/^Make disciples who make disciples/).className).toMatch(/italic/);
    expect(motto.className).toMatch(/border-gold-400/);
    expect(text.className).toMatch(/font-serif/);
  });

  it('has the motto in French too', async () => {
    mockFetch({ content: {} });
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('fr');
    renderAbout();
    const motto = await screen.findByTestId('about-motto');
    expect(motto).toHaveTextContent('Notre devise');
    expect(motto).toHaveTextContent('Allez dans les espaces des médias numériques où des milliards de personnes se rassemblent. Faites des disciples qui font des disciples, portant ainsi l’Évangile du Royaume jusqu’aux extrémités de la terre.');
    expect(screen.getByRole('heading', { name: 'Notre vision en action' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('does not depend on the admin\'s Vision, Mission or Purpose settings', async () => {
    mockFetch({ content: { appVisionEn: 'A nation for God.', appMissionEn: 'To train leaders.' } });
    renderAbout();
    expect(await screen.findByRole('heading', { name: 'Who we are' })).toBeInTheDocument();
    expect(screen.queryByText('A nation for God.')).toBeNull();
    expect(screen.queryByText('To train leaders.')).toBeNull();
  });

  it('is blue like the Home page, with links to take part and to represent your area', async () => {
    mockFetch({ content: {} });
    const { container } = renderAbout();
    await screen.findByRole('heading', { name: 'Who we are' });
    const header = container.querySelector('header.rounded-xl');
    expect(header?.className).toMatch(/from-brand-900/);
    expect(header?.className).not.toMatch(/amber|orange/);
    expect(screen.getByRole('link', { name: 'Represent The God Nation in your area' })).toHaveAttribute('href', '/member/leadership');
  });

  it('has Home and About tabs, and the Home tab goes back to the Home page', async () => {
    mockFetch({ content: {} });
    renderAbout();
    const tabs = within(await screen.findByRole('navigation', { name: 'Home sections' }));
    expect(tabs.getByRole('link', { name: 'About the God Nation' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(tabs.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText('The Home page')).toBeInTheDocument();
  });
});

describe('About page — our social networks, at the end', () => {
  const links = {
    whatsappContactUrl: 'https://chat.whatsapp.com/abc123',
    messengerUrl: 'https://m.me/j/xyz',
    facebookUrl: 'https://facebook.com/groups/godnation',
    youtubeUrl: 'https://youtube.com/@godnation',
  };

  it('shows the networks the admin has given a link for, each opening its link, after "How you can take part"', async () => {
    mockFetch({ content: {}, ...links });
    renderAbout();
    const box = await screen.findByTestId('about-social');
    expect(within(box).getByRole('heading', { name: 'Join our community' })).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'Join our WhatsApp group' })).toHaveAttribute('href', links.whatsappContactUrl);
    expect(within(box).getByRole('link', { name: 'Join our Messenger group' })).toHaveAttribute('href', links.messengerUrl);
    expect(within(box).getByRole('link', { name: 'Join our Facebook group' })).toHaveAttribute('href', links.facebookUrl);
    expect(within(box).getByRole('link', { name: 'Watch us on YouTube' })).toHaveAttribute('href', links.youtubeUrl);
    // Networks with no link yet do not show.
    expect(within(box).queryByRole('link', { name: /Telegram/ })).toBeNull();
    expect(within(box).queryByRole('link', { name: /Instagram/ })).toBeNull();
    expect(within(box).queryByRole('link', { name: /TikTok/ })).toBeNull();
    const join = screen.getByRole('heading', { name: 'How you can take part' });
    expect(join.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const a of within(box).getAllByRole('link')) expect(a).toHaveAttribute('target', '_blank');
  });

  it('has a place for the English and the French WhatsApp group, shown first', async () => {
    mockFetch({ content: {}, whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENG', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRE', youtubeUrl: links.youtubeUrl });
    renderAbout();
    const box = await screen.findByTestId('about-social');
    const all = within(box).getAllByRole('link');
    expect(all.map((a) => a.textContent)).toEqual(['Join our WhatsApp group (English)', 'Join our WhatsApp group (French)', 'Watch us on YouTube']);
    expect(all[0]).toHaveAttribute('href', 'https://chat.whatsapp.com/ENG');
    expect(all[1]).toHaveAttribute('href', 'https://chat.whatsapp.com/FRE');
  });

  it('shows the group wording in French too', async () => {
    mockFetch({ content: {}, whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENG', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRE' });
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('fr');
    renderAbout();
    const box = await screen.findByTestId('about-social');
    expect(within(box).getByRole('link', { name: 'Rejoindre notre groupe WhatsApp (anglais)' })).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'Rejoindre notre groupe WhatsApp (français)' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('shows all seven when all have links', async () => {
    mockFetch({ content: {}, ...links, telegramUrl: 'https://t.me/godnation', instagramUrl: 'https://instagram.com/godnation', tiktokUrl: 'https://tiktok.com/@godnation' });
    renderAbout();
    const box = await screen.findByTestId('about-social');
    expect(within(box).getAllByRole('link')).toHaveLength(7);
  });

  it('shows nothing at all until at least one link has been chosen', async () => {
    mockFetch({ content: {} });
    renderAbout();
    await screen.findByRole('heading', { name: 'How you can take part' });
    expect(screen.queryByTestId('about-social')).toBeNull();
  });

  it('is in French too', async () => {
    mockFetch({ content: {}, ...links });
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('fr');
    renderAbout();
    const box = await screen.findByTestId('about-social');
    expect(within(box).getByRole('heading', { name: 'Rejoignez notre communauté' })).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'Rejoindre notre groupe WhatsApp' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});

describe('Home and About tabs', () => {
  it('marks the current tab', () => {
    render(
      <MemoryRouter>
        <HomeAboutTabs active="home" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'About the God Nation' })).not.toHaveAttribute('aria-current');
  });
});
