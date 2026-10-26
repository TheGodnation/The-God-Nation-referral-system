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
  it('tells who we are, our calling and how to take part, and shows the ministry wording until the admin sets their own', async () => {
    mockFetch({ content: {} });
    renderAbout();
    expect(await screen.findByText('Who we are')).toBeInTheDocument();
    expect(screen.getByText(/mobilize and train the church to penetrate modern media/)).toBeInTheDocument();
    expect(screen.getByText(/hear the Word of God and be blessed, pray and be prayed for/)).toBeInTheDocument();
    expect(await screen.findByText('To leverage modern media to make the Gospel of the Kingdom accessible in every nation.')).toBeInTheDocument();
    expect(screen.getByText('To develop and deploy leaders who multiply disciples through scalable digital systems.')).toBeInTheDocument();
    expect(screen.getByText('To advance the Gospel of the Kingdom to every nation on earth.')).toBeInTheDocument();
    expect(screen.getByText(/Habakkuk 2:14/)).toBeInTheDocument();
    expect(screen.getByText('Learners')).toBeInTheDocument();
    expect(screen.getByText('Multipliers')).toBeInTheDocument();
    expect(screen.getByText(/is not a denomination/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Represent The God Nation in your area' })).toHaveAttribute('href', '/member/leadership');
  });

  it('uses the Vision, Mission and Purpose the admin saved, instead of the defaults', async () => {
    mockFetch({ content: { appVisionEn: 'A nation for God.', appMissionEn: 'To train leaders.', appPurposeEn: 'To serve.', appSloganEn: 'Raising kingdom leaders' } });
    renderAbout();
    expect(await screen.findByText('A nation for God.')).toBeInTheDocument();
    expect(screen.getByText('To train leaders.')).toBeInTheDocument();
    expect(screen.getByText('To serve.')).toBeInTheDocument();
    expect(screen.getByText('Raising kingdom leaders')).toBeInTheDocument();
    expect(screen.queryByText('To leverage modern media to make the Gospel of the Kingdom accessible in every nation.')).toBeNull();
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
