import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SharedPostPage } from '../pages/SharedPostPage';
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

  it('takes a member straight to the post on the Home page, already open', async () => {
    auth.member = { personId: 'p-me' };
    page();
    expect(await screen.findByTestId('where')).toHaveTextContent('/member/updates?open=p1');
    expect(screen.queryByTestId('shared-continue')).toBeNull();
  });

  it('does not decide before it knows whether the reader is signed in (no half page flashing for a member)', async () => {
    auth.loading = true;
    page();
    expect(await screen.findByTestId('shared-body')).toHaveTextContent('Paragraph 6.');
    expect(screen.queryByTestId('shared-continue')).toBeNull();
  });
});
