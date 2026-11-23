import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../i18n';
import { MemberShareSheet, MemberShareButton } from '../components/MemberShareSheet';
import { visitDetails } from '../lib/trackVisit';

// Any member shares a post with their own link: the address carries their own referral code.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

const serve = (linkStatus = 200) =>
  vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes('/api/member/shared/') && init?.method === 'POST') return linkStatus === 200 ? json({ path: '/news/post/p1', code: 'MARIE7X2' }) : json({ error: 'no' }, linkStatus);
    if (String(url).includes('/api/shared/post/p1')) return json({ title: { en: 'Good news', fr: 'Bonne nouvelle' }, body: { en: 'Come and see.', fr: 'Venez voir.' } });
    return json({});
  });

describe('Share with my link', () => {
  it('opens WhatsApp with a message whose link carries the member’s own code, in the chosen language', async () => {
    vi.stubGlobal('fetch', serve());
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<MemberShareSheet kind="post" id="p1" title="Good news" onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('member-share-wa'));
    const url = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(url).toContain('Good news');
    expect(url).toContain('/news/post/p1?ref=MARIE7X2&utm_source=member_share&utm_medium=social&lang=en');
    fireEvent.click(screen.getByTestId('member-share-lang-fr'));
    fireEvent.click(screen.getByTestId('member-share-wa'));
    const fr = decodeURIComponent(String(open.mock.calls[1][0]));
    expect(fr).toContain('Bonne nouvelle');
    expect(fr).toContain('ref=MARIE7X2');
    expect(fr).toContain('lang=fr');
  });

  it('gives Facebook just the address, with the code', async () => {
    vi.stubGlobal('fetch', serve());
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<MemberShareSheet kind="post" id="p1" title="Good news" onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('member-share-fb'));
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toContain('/news/post/p1?ref=MARIE7X2');
  });

  it('says so when the post cannot be shared', async () => {
    vi.stubGlobal('fetch', serve(409));
    render(<MemberShareSheet kind="update" id="u1" title="Hi" onClose={() => {}} />);
    expect(await screen.findByText('This post cannot be shared.')).toBeInTheDocument();
    expect(screen.queryByTestId('member-share-wa')).toBeNull();
  });

  it('is a small Share button that opens the sheet', async () => {
    vi.stubGlobal('fetch', serve());
    render(<MemberShareButton kind="post" id="p1" title="Good news" />);
    expect(screen.queryByTestId('member-share-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('member-share-post'));
    expect(await screen.findByTestId('member-share-sheet')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('member-share-wa')).toBeInTheDocument());
  });
});

describe('arriving by a member’s link', () => {
  it('records the referral code, and the visit is noted because the link carries tracking details', () => {
    const d = visitDetails('?ref=MARIE7X2&utm_source=member_share&utm_medium=social&lang=fr&v=abc', '', '/news/post/p1');
    expect(d).toMatchObject({ ref: 'MARIE7X2', utmSource: 'member_share', utmMedium: 'social', lang: 'fr', landingPage: '/news/post/p1?ref=MARIE7X2&utm_source=member_share&utm_medium=social&lang=fr&v=abc' });
  });
});
