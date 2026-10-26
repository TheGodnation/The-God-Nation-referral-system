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
  it('shows the academy\'s own text in four sections', async () => {
    mockFetch({ content: {} });
    renderAbout();
    expect(await screen.findByRole('heading', { name: 'Who we are' })).toBeInTheDocument();
    expect(screen.getByText(/exists to bring together citizens of the Kingdom of God/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our calling' })).toBeInTheDocument();
    expect(screen.getByText(/many years of personal encounters with Christ/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our vision in action' })).toBeInTheDocument();
    expect(screen.getByText(/modern media provides an unprecedented opportunity/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our mission' })).toBeInTheDocument();
    expect(screen.getByText(/From Cameroon to Africa and the ends of the earth/)).toBeInTheDocument();
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
