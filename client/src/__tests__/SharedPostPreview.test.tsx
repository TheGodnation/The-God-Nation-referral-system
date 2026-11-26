import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedPostPage, openInChromeLink } from '../pages/SharedPostPage';
import { previewOf, rememberPostToReturnTo, takePostToReturnTo } from '../lib/sharedPreview';

// A shared post opened by someone who is not a member: they read the beginning, then are invited to join to read the rest, and are
// brought back to the same post afterwards. (A member reads it all: see SharedPostMember.test.)
const auth = vi.hoisted(() => ({ member: null as null | { personId: string }, loading: false }));
vi.mock('../lib/MemberAuthContext', () => ({ useMemberAuth: () => auth }));

const para = (n: number) => `Paragraph ${n}. ` + 'The Kingdom of God is advancing in every nation and every home. '.repeat(3);
const LONG = [1, 2, 3, 4, 5, 6].map(para).join('\n\n');

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
const ITEM = { kind: 'post', id: 'p1', title: { en: 'Good news', fr: 'Bonne nouvelle' }, body: { en: LONG, fr: LONG }, author: 'The God Nation', publishedAt: null, mediaCount: 0, embed: null, more: [] };
function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
const page = () =>
  render(
    <MemoryRouter initialEntries={['/news/post/p1']}>
      <Routes>
        <Route path="/news/:kind/:id" element={<SharedPostPage />} />
        <Route path="/member/join" element={<p>join page</p>} />
        <Route path="/member/updates" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  auth.member = null;
  auth.loading = false;
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).includes('/api/shared/') ? json(ITEM) : json({ content: {} }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('previewOf', () => {
  it('keeps about half of a long post, whole paragraphs, never fewer than two', () => {
    const { shown, cut } = previewOf(LONG);
    expect(cut).toBe(true);
    expect(shown).toContain('Paragraph 1.');
    expect(shown).toContain('Paragraph 3.');
    expect(shown).not.toContain('Paragraph 5.');
    expect(shown.length).toBeGreaterThanOrEqual(LONG.length * 0.45);
    expect(shown.length).toBeLessThan(LONG.length * 0.75);
  });

  it('shows a short post whole', () => {
    expect(previewOf('Come and see what God is doing.')).toEqual({ shown: 'Come and see what God is doing.', cut: false });
  });

  it('cuts one long paragraph at the end of a sentence near half way', () => {
    const one = 'God is good. '.repeat(60).trim();
    const { shown, cut } = previewOf(one);
    expect(cut).toBe(true);
    expect(shown.endsWith('.')).toBe(true);
    expect(shown.length).toBeGreaterThan(one.length / 2 - 1);
    expect(shown.length).toBeLessThan(one.length * 0.6);
  });
});

describe('the way back to the post', () => {
  it('is remembered for the shared post only, taken once, and forgotten after a day', () => {
    rememberPostToReturnTo('/member/chats'); // not a shared post: ignored
    expect(takePostToReturnTo()).toBeNull();
    rememberPostToReturnTo('/news/post/p1');
    expect(takePostToReturnTo()).toBe('/news/post/p1');
    expect(takePostToReturnTo()).toBeNull(); // taken once
    rememberPostToReturnTo('/news/post/p1');
    expect(takePostToReturnTo(Date.now() + 25 * 60 * 60 * 1000)).toBeNull();
  });
});

describe('A long shared post opened by a visitor', () => {
  it('shows the beginning, then "Continue reading — it’s free" with Join and Sign in', async () => {
    page();
    const body = await screen.findByTestId('shared-body');
    expect(body).toHaveTextContent('Paragraph 1.');
    expect(body).not.toHaveTextContent('Paragraph 6.');
    expect(body).not.toHaveTextContent('Paragraph 5.');
    const card = screen.getByTestId('shared-continue');
    expect(card).toHaveTextContent('Continue reading — it\'s free');
    expect(card).toHaveTextContent('your digital home');
    expect(screen.getByTestId('shared-continue-join')).toHaveAttribute('href', '/member/join');
    expect(screen.getByTestId('shared-continue-signin')).toHaveAttribute('href', '/member/login');
  });

  it('remembers the post when they tap Join, so they come back to read all of it', async () => {
    page();
    fireEvent.click(await screen.findByTestId('shared-continue-join'));
    expect(await screen.findByText('join page')).toBeInTheDocument();
    expect(takePostToReturnTo()).toBe('/news/post/p1');
  });

  it('lets a member read all of it, then invites them into the Headquarters assembly', async () => {
    auth.member = { personId: 'p-me' };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/shared/')) return json(ITEM);
      if (String(url).includes('/api/member/me/community-memberships')) return json({ items: [{ communityId: 'gen1', generation: 1 }, { communityId: 'hq-id', generation: 0 }] });
      return json({ content: {} });
    }));
    page();
    expect(await screen.findByTestId('shared-body')).toHaveTextContent('Paragraph 6.');
    expect(screen.queryByTestId('shared-continue')).toBeNull();
    const enter = screen.getByTestId('shared-enter');
    expect(enter).toHaveTextContent('Visit the Headquarters assembly');
    await waitFor(() => expect(enter).toHaveAttribute('href', '/member/chats/group/hq-id'));
    expect(screen.getByTestId('shared-join')).toHaveTextContent('For the latest news');
  });

  it('does not decide before it knows whether the reader is signed in (no half page flashing for a member)', async () => {
    auth.loading = true;
    page();
    expect(await screen.findByTestId('shared-body')).toHaveTextContent('Paragraph 6.');
    expect(screen.queryByTestId('shared-continue')).toBeNull();
  });
});

describe('Open in Chrome (inside Facebook’s browser, which never knows a member is signed in)', () => {
  const FB = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.40.109;]';
  it('gives a link that opens the same page in Chrome, on Android inside Facebook', () => {
    expect(openInChromeLink(FB, 'https://thegodnationacademy.org/news/post/p1')).toBe(
      'intent://thegodnationacademy.org/news/post/p1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fthegodnationacademy.org%2Fnews%2Fpost%2Fp1;end',
    );
  });
  it('offers nothing in Chrome itself, in WhatsApp’s window, or on an iPhone', () => {
    expect(openInChromeLink('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'https://x.org/news/post/p1')).toBeNull();
    expect(openInChromeLink('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/480.0]', 'https://x.org/news/post/p1')).toBeNull();
  });
});
