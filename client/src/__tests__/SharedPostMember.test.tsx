import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SharedPostPage } from '../pages/SharedPostPage';

// A member who is already signed in sees a button into the community, not "join" or "sign in".
vi.mock('../lib/MemberAuthContext', () => ({
  useMemberAuth: () => ({ member: { personId: 'p-me', name: 'Me', isCentralAdmin: false }, loading: false }),
}));

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('A shared post opened by a signed-in member', () => {
  it('offers to go into the community', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).includes('/api/shared/') ? json({ kind: 'post', id: 'p1', title: { en: 'Good news', fr: 'Bonne nouvelle' }, body: { en: 'Come.', fr: 'Venez.' }, author: 'The God Nation', publishedAt: null, mediaCount: 0, embed: null, more: [] }) : json({ content: {} }))));
    render(
      <MemoryRouter initialEntries={['/news/post/p1']}>
        <Routes>
          <Route path="/news/:kind/:id" element={<SharedPostPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('shared-enter')).toHaveAttribute('href', '/member/chats');
    expect(screen.queryByTestId('shared-cta')).toBeNull();
    expect(screen.queryByTestId('shared-signin')).toBeNull();
  });
});
