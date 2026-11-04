import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberUpdatesPage } from '../pages/MemberUpdatesPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

// The home page shows posts, but writing a post (and the Everyone / Friends choice) is on the profile.
afterEach(() => vi.unstubAllGlobals());

it('the home page has no post box and no Everyone / Friends tabs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.startsWith('/api/updates')
        ? { viewer: { canPost: true, canModerate: false, personId: 'p1' }, items: [], nextBefore: null }
        : url.startsWith('/api/member/auth/me')
          ? { member: { name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', personId: 'p1', profileComplete: true } }
          : {};
      const status = url.startsWith('/api/settings/public') ? 404 : 200;
      return Promise.resolve({ ok: status === 200, status, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
  render(
    <MemoryRouter>
      <MemberAuthProvider>
        <MemberUpdatesPage />
      </MemberAuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/updates'), expect.anything()));
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByLabelText('Write a post')).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Everyone' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Friends' })).toBeNull();
  expect(screen.queryByTestId('post-audience')).toBeNull();
});
