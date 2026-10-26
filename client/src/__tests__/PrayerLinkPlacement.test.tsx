import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { MemberUpdatesPage } from '../pages/MemberUpdatesPage';
import { MemberPeoplePage } from '../pages/MemberPeoplePage';

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.split('?')[0];
      const body =
        path === '/api/member/auth/me'
          ? { member: { name: 'Grace Ngwa', email: 'g@example.com', preferredLanguage: 'en', personId: 'p1', profileComplete: true, photoUrl: null } }
          : path === '/api/settings/public'
            ? { content: {} }
            : path === '/api/updates'
              ? { viewer: { canPost: true, canModerate: false, personId: 'p1' }, items: [], nextBefore: null }
              : path === '/api/member/people/strip'
                ? { items: [] }
                : { items: [], total: 0, unreadCount: 0 };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const wrap = (el: React.ReactNode) => (
  <MemoryRouter>
    <MemberAuthProvider>{el}</MemberAuthProvider>
  </MemoryRouter>
);

describe('Prayer requests link', () => {
  it('is no longer a bar on the Home page', async () => {
    mockFetch();
    const { container } = render(wrap(<MemberUpdatesPage />));
    await screen.findByText('Discover Members').catch(() => undefined);
    await screen.findByRole('navigation', { name: 'Home sections' });
    expect(container.querySelector('a[href="/member/prayer"]')).toBeNull();
  });

  it('is found on the People page instead', async () => {
    mockFetch();
    render(wrap(<MemberPeoplePage />));
    const link = await screen.findByRole('link', { name: /Prayer Requests/ });
    expect(link).toHaveAttribute('href', '/member/prayer');
  });
});
