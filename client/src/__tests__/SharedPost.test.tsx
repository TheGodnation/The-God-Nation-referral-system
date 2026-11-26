import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n';
import { SharedPostPage } from '../pages/SharedPostPage';
import { ShareByLinkSheet, shareBaseFor, whatsappText, composeShare } from '../components/ShareByLinkSheet';

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
    // The founder's invitation, above Join now.
    expect(screen.getByTestId('shared-pitch-title')).toHaveTextContent('Become an equipped, connected and impactful Kingdom citizen!');
    expect(screen.getByTestId('shared-join')).toHaveTextContent("Don't just be a believer.");
    expect(screen.getByTestId('shared-pitch-points')).toHaveTextContent('Represent the Kingdom.');
    expect(screen.getByTestId('shared-join')).toHaveTextContent('Be a voice. Be part of The God Nation!');
    expect(screen.getByTestId('shared-join')).not.toHaveTextContent('Be equipped. Be connected.');
    expect(screen.getByTestId('shared-join')).toHaveTextContent("Together, let's reach the billions of people online through modern media.");
    expect(screen.getByTestId('shared-more')).toHaveTextContent('Meeting');
    // an existing member can sign in and go straight into the community
    expect(screen.getByTestId('shared-signin')).toHaveAttribute('href', '/member/login');
    expect(screen.getByTestId('shared-signin')).toHaveTextContent('Sign in and go into the community');
  });

  it('shows the post’s pictures above the writing when there are some', async () => {
    vi.stubGlobal('fetch', serve(() => json({ ...ITEM, photos: [{ url: '/api/shared/post/p1/photo/0' }, { url: '/api/shared/post/p1/photo/1' }] })));
    page();
    const photos = await screen.findByTestId('shared-photos');
    expect(photos.querySelectorAll('img')).toHaveLength(2);
    expect(photos.querySelector('img')).toHaveAttribute('src', '/api/shared/post/p1/photo/0');
    expect(screen.queryByTestId('shared-media-note')).toBeNull(); // the note is for pictures that cannot be shown
  });

  it('draws ## lines as headings, not as raw symbols', async () => {
    vi.stubGlobal('fetch', serve(() => json({ ...ITEM, body: { en: '## A DECLARATION OF VICTORY\nHeavenly Father, we thank You.', fr: '' } })));
    page();
    const body = await screen.findByTestId('shared-body');
    expect(body).toHaveTextContent('A DECLARATION OF VICTORY');
    expect(body).not.toHaveTextContent('##');
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

describe('The message that is shared: heading, sub-heading, the writing, then Read more', () => {
  const link = 'https://example.org/news/update/u1?lang=en';
  const POST = '**THEY COULD COME AGAINST YOU BY ONE WAY!**\n\n## A DECLARATION OF VICTORY OVER EVERY MEMBER\nHeavenly Father, in the mighty name of Jesus, we thank You for Your protection.\nFather, Your Word says it.';

  it('puts the heading, the sub-heading, the writing and "Read more" with the link in that order (WhatsApp marks)', () => {
    const text = whatsappText({ title: 'THEY COULD COME AGAINST YOU BY ONE WAY!', teaser: POST, link, readMore: 'Read more:' });
    expect(text).toBe(
      `📣 *THEY COULD COME AGAINST YOU BY ONE WAY!*\n_A DECLARATION OF VICTORY OVER EVERY MEMBER_\n\nHeavenly Father, in the mighty name of Jesus, we thank You for Your protection. Father, Your Word says it.\n\n👉 *Read more:*\n${link}`,
    );
  });

  it('has the same order without WhatsApp marks for Facebook, e-mail and the like', () => {
    const text = composeShare({ title: 'THEY COULD COME AGAINST YOU BY ONE WAY!', teaser: POST, link, readMore: 'Read more:', style: 'plain' });
    expect(text.split('\n')).toEqual([
      '📣 THEY COULD COME AGAINST YOU BY ONE WAY!',
      'A DECLARATION OF VICTORY OVER EVERY MEMBER',
      '',
      'Heavenly Father, in the mighty name of Jesus, we thank You for Your protection. Father, Your Word says it.',
      '',
      '👉 Read more:',
      link,
    ]);
    expect(text).not.toMatch(/[*_#]/);
  });

  it('has no sub-heading line when the post has none, and cuts a long writing at a sentence', () => {
    const long = `${'Come and see what God is doing among us today. '.repeat(14)}`;
    const text = composeShare({ title: 'Good news', teaser: `Good news\n${long}`, link, readMore: 'Read more:', style: 'plain' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('📣 Good news');
    expect(lines[1]).toBe(''); // straight to the writing
    expect(lines[2].length).toBeLessThanOrEqual(381);
    expect(lines[2].endsWith('today.')).toBe(true);
    expect(text.match(/Good news/g)).toHaveLength(1);
  });

  it('works with no writing at all, and removes marks that would break the formatting', () => {
    expect(whatsappText({ title: 'A *bold* title', teaser: null, link, readMore: 'Read more:' })).toBe(`📣 *A bold title*\n\n👉 *Read more:*\n${link}`);
  });
});

describe('The share sheet: copy the message', () => {
  it('copies the plain message, in the same order, in the chosen language', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).startsWith('/api/shared/') ? json({ title: { en: 'Good news', fr: 'Bonne nouvelle' }, body: { en: 'Good news\nCome and see.', fr: 'Bonne nouvelle\nVenez voir.' } }) : json({ shared: true, path: '/news/post/p1' }))));
    render(<ShareByLinkSheet kind="post" id="p1" title="Good news" base="/api/member/central-shared" onClose={() => {}} />);
    await screen.findByTestId('share-link');
    await waitFor(() => expect(screen.queryByTestId('share-no-french')).toBeNull());
    fireEvent.click(screen.getByTestId('share-lang-fr'));
    fireEvent.click(screen.getByTestId('share-copy-message'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = (writeText.mock.calls as unknown as string[][])[0][0];
    expect(copied.split('\n')[0]).toBe('📣 Bonne nouvelle');
    expect(copied).toContain('Venez voir.');
    expect(copied).toContain('👉 Lire la suite :');
    expect(copied).not.toMatch(/[*_#]/);
  });
});

describe('The share sheet', () => {
  it('picks the right door for the dashboard and for the member profile', () => {
    expect(shareBaseFor('/api/admin/headquarters-posts')).toBe('/api/admin/shared');
    expect(shareBaseFor('/api/member/central-headquarters-posts')).toBe('/api/member/central-shared');
    expect(shareBaseFor(undefined)).toBe('/api/admin/shared');
  });

  it('writes the French message with the French words of the post, and says when there is no French', async () => {
    const opened: string[] = [];
    vi.spyOn(window, 'open').mockImplementation((u) => { opened.push(String(u)); return null; });
    let words = { title: { en: 'Good news', fr: 'Bonne nouvelle' }, body: { en: 'Come and see what God is doing.', fr: 'Venez voir ce que Dieu fait.' } };
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).startsWith('/api/shared/') ? json(words) : json({ shared: true, path: '/news/update/u1' }))));
    const first = render(<ShareByLinkSheet kind="update" id="u1" title="Good news" teaser={{ en: 'Come and see what God is doing.', fr: 'Come and see what God is doing.' }} base="/api/member/central-shared" onClose={() => {}} />);
    await screen.findByTestId('share-link');
    await waitFor(() => expect(screen.queryByTestId('share-no-french')).toBeNull());
    fireEvent.click(screen.getByTestId('share-lang-fr'));
    fireEvent.click(screen.getByTestId('share-wa'));
    const text = decodeURIComponent(opened[0].split('text=')[1]);
    expect(text).toContain('📣 *Bonne nouvelle*');
    expect(text).toContain('Venez voir ce que Dieu fait.');
    expect(text).toContain('👉 *Lire la suite :*');
    expect(text).not.toContain('Come and see');
    first.unmount();
    words = { title: { en: 'Good news', fr: 'Good news' }, body: { en: 'Come and see.', fr: 'Come and see.' } };
    render(<ShareByLinkSheet kind="update" id="u1" title="Good news" base="/api/member/central-shared" onClose={() => {}} />);
    expect(await screen.findByTestId('share-no-french')).toBeInTheDocument();
  });

  it('opens the link, shares to WhatsApp and Facebook in the chosen language, and can stop sharing', async () => {
    let shared = false;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string }) => {
        if (String(url).startsWith('/api/shared/') || String(url).endsWith('/website')) return json({}); // the public words and the website state (not part of this check)
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
    fireEvent.click(screen.getByTestId('share-lang-fr'));
    fireEvent.click(screen.getByTestId('share-wa'));
    expect(String(open.mock.calls[0][0])).toContain(encodeURIComponent('/news/post/p1?lang=fr'));
    // the same link for Facebook, which draws its own card from it
    fireEvent.click(screen.getByTestId('share-fb'));
    expect(String(open.mock.calls[1][0])).toContain('facebook.com/sharer/sharer.php?u=');
    expect(decodeURIComponent(String(open.mock.calls[1][0]))).toContain('/news/post/p1?lang=fr');
    fireEvent.click(screen.getByTestId('share-stop'));
    await waitFor(() => expect(screen.getByTestId('share-open')).toBeInTheDocument());
    expect(calls).toEqual(['GET /api/member/central-shared/post/p1', 'POST /api/member/central-shared/post/p1/share', 'DELETE /api/member/central-shared/post/p1/share']);
  });
});

describe('Also publish on the website', () => {
  const divisions = [{ key: 'kingdom-knowledge', name: { en: 'Kingdom Knowledge', fr: 'Connaissance du Royaume' } }];
  function serveSite(initial: Record<string, unknown>) {
    let site: Record<string, unknown> = { published: false, divisions, ...initial };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (u.startsWith('/api/shared/')) return json({});
        if (u.endsWith('/website')) {
          calls.push(`${init?.method ?? 'GET'} ${u.split('/').slice(-3).join('/')}${init?.body ? ` ${init.body}` : ''}`);
          if (init?.method === 'POST') site = { published: true, divisions, paths: { en: '/en/knowledge/kingdom-knowledge/x/', fr: '/fr/connaissance/connaissance-du-royaume/x/' }, hasFrench: true, frenchReviewed: false };
          if (init?.method === 'DELETE') site = { published: false, divisions };
          return json(site);
        }
        return json({ shared: true, path: '/news/post/p1' });
      }),
    );
    return calls;
  }

  it('asks where it belongs, publishes at once, links to both pages, and says the French is automatic', async () => {
    const calls = serveSite({});
    render(<ShareByLinkSheet kind="post" id="p1" title="Good news" base="/api/member/central-shared" onClose={() => {}} />);
    const publish = await screen.findByTestId('website-publish');
    expect(publish).toBeDisabled(); // an area must be chosen first
    fireEvent.change(screen.getByTestId('website-area'), { target: { value: 'kingdom-knowledge' } });
    fireEvent.click(publish);
    expect(await screen.findByTestId('website-live')).toHaveTextContent('Google');
    expect(screen.getByText('See the French page')).toHaveAttribute('href', expect.stringContaining('/fr/connaissance/'));
    expect(screen.getByTestId('website-french')).toHaveTextContent('made automatically');
    expect(calls).toContain('POST post/p1/website {"divisionKey":"kingdom-knowledge"}');
  });

  it('can be updated and taken off the website again', async () => {
    const calls = serveSite({ published: true, divisionKey: 'kingdom-knowledge', paths: { en: '/en/knowledge/a/b/' }, hasFrench: false });
    render(<ShareByLinkSheet kind="post" id="p1" title="Good news" base="/api/member/central-shared" onClose={() => {}} />);
    expect(await screen.findByTestId('website-live')).toBeInTheDocument();
    expect(screen.getByTestId('website-french')).toHaveTextContent('only the English page');
    fireEvent.click(screen.getByTestId('website-off'));
    expect(await screen.findByTestId('website-publish')).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(true);
  });
});
