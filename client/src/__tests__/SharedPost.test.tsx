import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n';
import { SharedPostPage } from '../pages/SharedPostPage';
import { ShareByLinkSheet, shareBaseFor, whatsappText } from '../components/ShareByLinkSheet';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

const ITEM = {
  kind: 'post',
  id: 'p1',
  title: { en: 'Good news', fr: 'Bonne nouvelle' },
  body: { en: 'Come and see.', fr: 'Venez voir.' },
  author: 'The God Nation',
  publishedAt: '2027-01-05T10:00:00.000Z',
  mediaCount: 2,
  embed: null,
  more: [{ kind: 'announcement', id: 'a1', title: { en: 'Meeting', fr: 'Réunion' } }],
};
const serve = (shared: () => Promise<unknown>) => vi.fn((url: string) => (String(url).includes('/api/shared/') ? shared() : json({ content: {} })));
const page = () =>
  render(
    <MemoryRouter initialEntries={['/news/post/p1']}>
      <Routes>
        <Route path="/news/:kind/:id" element={<SharedPostPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('A shared post page', () => {
  it('lets a visitor read it and invites them to join', async () => {
    vi.stubGlobal('fetch', serve(() => json(ITEM)));
    page();
    expect(await screen.findByTestId('shared-title')).toHaveTextContent('Good news');
    expect(screen.getByTestId('shared-body')).toHaveTextContent('Come and see.');
    expect(screen.getByTestId('shared-media-note')).toHaveTextContent('2 photos or videos');
    expect(screen.getByTestId('shared-cta')).toHaveAttribute('href', '/member/join');
    expect(screen.getByTestId('shared-more')).toHaveTextContent('Meeting');
    // an existing member can sign in and go straight into the community
    expect(screen.getByTestId('shared-signin')).toHaveAttribute('href', '/member/login');
    expect(screen.getByTestId('shared-signin')).toHaveTextContent('Sign in and go into the community');
  });

  it('reads in French for a French visitor', async () => {
    await i18n.changeLanguage('fr');
    vi.stubGlobal('fetch', serve(() => json(ITEM)));
    page();
    expect(await screen.findByTestId('shared-title')).toHaveTextContent('Bonne nouvelle');
    expect(screen.getByTestId('shared-cta')).toHaveTextContent('Rejoindre maintenant');
  });

  it('says the link is not available when it is closed, but still offers to join', async () => {
    vi.stubGlobal('fetch', serve(() => json({ error: 'x' }, 404)));
    page();
    expect(await screen.findByTestId('shared-closed')).toHaveTextContent('This link is not available');
    expect(screen.queryByTestId('shared-body')).toBeNull();
  });
});

describe('The words sent to WhatsApp with the link', () => {
  const link = 'https://example.org/news/update/u1?lang=en';
  it('puts the title and the first lines in bold, then "Read more" and the link', () => {
    const text = whatsappText({ title: 'Good news', teaser: 'Come and see\nwhat God is doing among us.', link, readMore: 'Read more:' });
    expect(text).toBe(`📣 *Good news*\n*Come and see what God is doing among us.*\n\n👉 Read more:\n${link}`);
  });
  it('does not repeat a title the post starts with, and cuts a long start at a word', () => {
    const long = `A Testimony ${'In 1990 we were in the city of Kano, the Muslim city in northern Nigeria. '.repeat(6)}`;
    const text = whatsappText({ title: 'A Testimony', teaser: long, link, readMore: 'Read more:' });
    const bold = text.split('\n')[1];
    expect(bold.startsWith('*In 1990 we were')).toBe(true);
    expect(bold.endsWith('…*')).toBe(true);
    expect(bold.length).toBeLessThan(240);
    expect(text.match(/A Testimony/g)).toHaveLength(1);
  });
  it('removes formatting characters that would break the bold, and works with no first lines', () => {
    expect(whatsappText({ title: 'A *bold* title', teaser: null, link, readMore: 'Read more:' })).toBe(`📣 *A bold title*\n\n👉 Read more:\n${link}`);
  });
});

describe('The share sheet', () => {
  it('picks the right door for the dashboard and for the member profile', () => {
    expect(shareBaseFor('/api/admin/headquarters-posts')).toBe('/api/admin/shared');
    expect(shareBaseFor('/api/member/central-headquarters-posts')).toBe('/api/member/central-shared');
    expect(shareBaseFor(undefined)).toBe('/api/admin/shared');
  });

  it('opens the link, offers WhatsApp in both languages, and can stop sharing', async () => {
    let shared = false;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string }) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (init?.method === 'POST') shared = true;
        if (init?.method === 'DELETE') shared = false;
        return json({ shared, path: '/news/post/p1' });
      }),
    );
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ShareByLinkSheet kind="post" id="p1" title="Good news" base="/api/member/central-shared" onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('share-open'));
    expect(await screen.findByTestId('share-link')).toHaveTextContent('/news/post/p1');
    fireEvent.click(screen.getByTestId('share-wa-fr'));
    expect(String(open.mock.calls[0][0])).toContain(encodeURIComponent('/news/post/p1?lang=fr'));
    fireEvent.click(screen.getByTestId('share-stop'));
    await waitFor(() => expect(screen.getByTestId('share-open')).toBeInTheDocument());
    expect(calls).toEqual(['GET /api/member/central-shared/post/p1', 'POST /api/member/central-shared/post/p1/share', 'DELETE /api/member/central-shared/post/p1/share']);
  });
});
