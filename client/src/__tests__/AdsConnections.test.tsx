import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberSignupPage } from '../pages/MemberSignupPage';
import { ContactPreferencesCard } from '../components/member/ContactPreferencesCard';
import { AdsConsentBanner } from '../components/AdsConsentBanner';
import { AdsCard } from '../components/admin/AdsCard';
import { LinkBuilder } from '../components/admin/LinkBuilder';
import { buildLink, slug, PRESETS } from '../lib/linkBuilder';
import { getAdsChoice, getFbp, loadPixels, configureAds, resetAdsForTests, trackAd, setAdsChoice } from '../lib/adsTracking';
import i18n from '../i18n';

// Phase C, client side: nothing from an ad platform loads before the visitor says
// "Allow"; the sign-up box and event ids; the Ads card; and the tagged link maker.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(responses: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = Object.keys(responses).sort((a, b) => b.length - a.length).find((k) => {
        const [m, path] = k.includes(' ') ? k.split(' ') : [method, k];
        return m === method && url.includes(path);
      });
      const res = key ? responses[key] : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

const ADS = { metaPixelId: '123456789012', tiktokPixelId: 'TTPIXEL1234', googleTagId: 'AW-123456789', googleLeadSendTo: 'AW-123456789/LeadLabel1', googleSignupSendTo: null };
const settings = (ads: unknown) => ({ supportWhatsappUrl: null, whatsappGroupEnUrl: null, whatsappGroupFrUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null, youtubeUrl: null, telegramUrl: null, messengerUrl: null, content: {}, ads });

function scriptSrcs() {
  return Array.from(document.head.querySelectorAll('script')).map((s) => s.getAttribute('src') ?? '');
}

beforeEach(() => {
  localStorage.clear();
  resetAdsForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  localStorage.clear();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  for (const k of ['fbq', '_fbq', 'ttq', 'TiktokAnalyticsObject', 'gtag', 'dataLayer']) delete (window as any)[k];
  i18n.changeLanguage('en');
});

describe('Browser pixels wait for "Allow"', () => {
  it('loads nothing before the visitor chose, and nothing after "No"', () => {
    configureAds(ADS);
    loadPixels();
    expect(scriptSrcs()).toEqual([]);
    setAdsChoice('no');
    loadPixels();
    trackAd('Lead', 'evt-12345678');
    expect(scriptSrcs()).toEqual([]);
    expect((window as any).fbq).toBeUndefined();
  });

  it('after "Allow" loads Meta, TikTok and Google once, and passes the shared event id on', () => {
    configureAds(ADS);
    setAdsChoice('yes');
    loadPixels();
    const srcs = scriptSrcs();
    expect(srcs.filter((s) => s.includes('connect.facebook.net'))).toHaveLength(1);
    expect(srcs.some((s) => s.includes('analytics.tiktok.com') && s.includes('TTPIXEL1234'))).toBe(true);
    expect(srcs.some((s) => s.includes('googletagmanager.com/gtag/js?id=AW-123456789'))).toBe(true);

    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const track = vi.fn();
    (window as any).ttq = { track };
    const gtag = vi.fn();
    (window as any).gtag = gtag;
    trackAd('Lead', 'evt-12345678');
    expect(fbq).toHaveBeenCalledWith('track', 'Lead', {}, { eventID: 'evt-12345678' });
    expect(track).toHaveBeenCalledWith('SubmitForm', {}, { event_id: 'evt-12345678' });
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', { send_to: 'AW-123456789/LeadLabel1', transaction_id: 'evt-12345678' });
    trackAd('CompleteRegistration', 'evt-87654321');
    expect(track).toHaveBeenCalledWith('CompleteRegistration', {}, { event_id: 'evt-87654321' });
    expect(gtag).toHaveBeenCalledTimes(1); // no finished-joining label was set
  });

  it('only a valid Meta cookie is passed on, and only after "Allow"', () => {
    document.cookie = '_fbp=fb.1.1700000000000.1234567890';
    expect(getFbp()).toBeUndefined();
    localStorage.setItem('gn_ads_consent', 'yes');
    expect(getFbp()).toBe('fb.1.1700000000000.1234567890');
    document.cookie = '_fbp=junk';
    expect(getFbp()).toBeUndefined();
    expect(getAdsChoice()).toBe('yes');
  });
});

describe('Consent banner', () => {
  it('stays hidden while no platform is connected', async () => {
    mockFetch({ '/api/settings/public': { body: settings({ metaPixelId: null, tiktokPixelId: null, googleTagId: null, googleLeadSendTo: null, googleSignupSendTo: null }) } });
    render(<MemoryRouter><AdsConsentBanner /></MemoryRouter>);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('ads-banner')).toBeNull();
    expect(scriptSrcs()).toEqual([]);
  });

  it('asks once; "No thanks" loads nothing and does not ask again, "Allow" loads the tools', async () => {
    mockFetch({ '/api/settings/public': { body: settings(ADS) } });
    const { unmount } = render(<MemoryRouter><AdsConsentBanner /></MemoryRouter>);
    expect(await screen.findByTestId('ads-banner')).toBeInTheDocument();
    expect(scriptSrcs()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(screen.queryByTestId('ads-banner')).toBeNull();
    expect(localStorage.getItem('gn_ads_consent')).toBe('no');
    expect(scriptSrcs()).toEqual([]);
    unmount();

    localStorage.clear();
    render(<MemoryRouter><AdsConsentBanner /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(localStorage.getItem('gn_ads_consent')).toBe('yes');
    expect(scriptSrcs().some((s) => s.includes('connect.facebook.net'))).toBe(true);
  });

  it('loads the tools at once on a later visit when the visitor already said yes', async () => {
    localStorage.setItem('gn_ads_consent', 'yes');
    mockFetch({ '/api/settings/public': { body: settings(ADS) } });
    render(<MemoryRouter><AdsConsentBanner /></MemoryRouter>);
    await waitFor(() => expect(scriptSrcs().some((s) => s.includes('connect.facebook.net'))).toBe(true));
    expect(screen.queryByTestId('ads-banner')).toBeNull();
  });
});

describe('Sign-up ads box', () => {
  async function fill() {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone number (WhatsApp)'), { target: { value: '+237670000001' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
  }

  it('is not offered while no platform is connected', async () => {
    mockFetch({ '/api/settings/public': { body: settings(null) }, '/api/member/auth/signup': { body: { message: 'ok' } } });
    render(<MemoryRouter><MemberSignupPage /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('signup-consent-ads')).toBeNull();
  });

  it('is offered unticked when connected, and a tick sends the agreement with an event id', async () => {
    mockFetch({ '/api/settings/public': { body: settings(ADS) }, '/api/member/auth/signup': { body: { message: 'ok' } } });
    render(<MemoryRouter><MemberSignupPage /></MemoryRouter>);
    const box = (await screen.findByTestId('signup-consent-ads')) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/Meta \(Facebook and Instagram\), TikTok and Google/)).toBeInTheDocument();
    await fill();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    const body = calls.find((c) => c.url.includes('/api/member/auth/signup'))!.body;
    expect(body.consentAds).toBe(true);
    expect(body.adEventId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('left unticked, sends no agreement and no event id', async () => {
    mockFetch({ '/api/settings/public': { body: settings(ADS) }, '/api/member/auth/signup': { body: { message: 'ok' } } });
    render(<MemoryRouter><MemberSignupPage /></MemoryRouter>);
    await screen.findByTestId('signup-consent-ads');
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    const body = calls.find((c) => c.url.includes('/api/member/auth/signup'))!.body;
    expect(body.consentAds).toBeUndefined();
    expect(body.adEventId).toBeUndefined();
  });
});

describe('Contact preferences: ads choice', () => {
  it('shows the ads row and the device choice only when connected, and saves a change', async () => {
    mockFetch({
      '/api/settings/public': { body: settings(ADS) },
      'GET /api/member/contact-consent': { body: { whatsapp: null, email: null, ads: null } },
      'PUT /api/member/contact-consent': { body: { whatsapp: null, email: null, ads: true } },
    });
    render(<ContactPreferencesCard />);
    const ads = (await screen.findByLabelText(/Share my scrambled \(hashed\) email and phone number/)) as HTMLInputElement;
    expect(screen.getByTestId('ads-device-choice')).toBeInTheDocument();
    fireEvent.click(ads);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ads: true }));
    await waitFor(() => expect(ads.checked).toBe(true));
  });

  it('hides both when nothing is connected', async () => {
    mockFetch({ '/api/settings/public': { body: settings(null) }, 'GET /api/member/contact-consent': { body: { whatsapp: null, email: null, ads: null } } });
    render(<ContactPreferencesCard />);
    await screen.findByTestId('contact-prefs');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByLabelText(/scrambled/)).toBeNull();
    expect(screen.queryByTestId('ads-device-choice')).toBeNull();
  });
});

describe('Tagged link maker', () => {
  const base = { origin: 'https://thegodnationacademy.org', destination: 'join' as const, preset: 'facebook' as const, ...PRESETS.facebook, campaign: 'November Launch!', content: 'Video 1', lang: 'fr' as const };

  it('cleans the names and builds the plain link', () => {
    expect(slug('  November Launch! ')).toBe('november-launch');
    expect(buildLink(base).link).toBe('https://thegodnationacademy.org/member/join?utm_source=facebook&utm_medium=paid&utm_campaign=november-launch&utm_content=video-1&lang=fr');
  });

  it('leaves out what is empty', () => {
    expect(buildLink({ ...base, destination: 'home', campaign: '', content: '', lang: '' }).link).toBe('https://thegodnationacademy.org/?utm_source=facebook&utm_medium=paid');
    expect(buildLink({ ...base, origin: 'https://x.org/', preset: 'other', source: '', medium: '', campaign: '', content: '', lang: '' }).link).toBe('https://x.org/member/join');
  });

  it('gives each ad platform its own automatic names', () => {
    expect(buildLink(base).dynamicParams).toBe('utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&lang=fr');
    expect(buildLink({ ...base, preset: 'tiktok', ...PRESETS.tiktok }).dynamicParams).toContain('utm_campaign=__CAMPAIGN_NAME__');
    expect(buildLink({ ...base, preset: 'google', ...PRESETS.google }).dynamicLink).toContain('utm_campaign={campaignid}&utm_content={creative}');
    expect(buildLink({ ...base, preset: 'whatsapp', ...PRESETS.whatsapp }).dynamicParams).toBe('');
  });

  it('renders, updates as you type, and offers the automatic names for ads', () => {
    render(<LinkBuilder />);
    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Easter' } });
    expect((screen.getByLabelText('Your link') as HTMLInputElement).value).toContain('utm_campaign=easter');
    expect((screen.getByLabelText('URL parameters (for the ad platform)') as HTMLInputElement).value).toContain('{{campaign.name}}');
    fireEvent.change(screen.getByLabelText('Where you will put it'), { target: { value: 'whatsapp' } });
    expect((screen.getByLabelText('Your link') as HTMLInputElement).value).toContain('utm_source=whatsapp&utm_medium=social');
    expect(screen.queryByLabelText('URL parameters (for the ad platform)')).toBeNull();
  });
});

describe('Ads card', () => {
  const summary = {
    ids: { metaPixelId: '123456789012', tiktokPixelId: null, googleTagId: null, googleLeadSendTo: null, googleSignupSendTo: null },
    meta: { tokenSet: true, testMode: true, serverReady: true },
    tiktok: { tokenSet: false, testMode: false, serverReady: false },
    last7: { ok: 3, failed: 1 },
    recent: [
      { id: '1', platform: 'meta', event: 'Lead', ok: true, status: 200, error: null, createdAt: '2026-11-03T10:00:00Z' },
      { id: '2', platform: 'tiktok', event: 'Lead', ok: false, status: 401, error: 'bad token', createdAt: '2026-11-03T09:00:00Z' },
    ],
    audiences: { members: 12, quiet: 4, quietDays: 7 },
  };

  it('shows the status, the recent events and the downloads, with the honest "not yet tested" note', async () => {
    mockFetch({ '/api/admin/ads': { body: summary } });
    render(<AdsCard base="/api/admin/ads" />);
    expect(await screen.findByTestId('ads-card')).toBeInTheDocument();
    expect(screen.getByText(/Not yet tested with the live platforms/)).toBeInTheDocument();
    expect((screen.getByLabelText('Meta pixel (dataset) id') as HTMLInputElement).value).toBe('123456789012');
    expect(screen.getByTestId('ads-last7')).toHaveTextContent('3 events sent, 1 failed');
    expect(screen.getByText('Failed (401): bad token')).toBeInTheDocument();
    expect(screen.getByText('test mode')).toBeInTheDocument();
    expect(screen.getByTestId('ads-download-members')).toHaveAttribute('href', '/api/admin/ads/audience.csv?kind=members');
    expect(screen.getByTestId('ads-download-members')).toHaveTextContent('(12)');
    expect(screen.getByTestId('ads-download-quiet')).toHaveTextContent('Quiet 7+ days (4)');
  });

  it('saves the ids, and says so when the server refuses one', async () => {
    mockFetch({ 'GET /api/admin/ads': { body: summary }, 'PUT /api/admin/ads': { body: { ...summary, ids: { ...summary.ids, tiktokPixelId: 'CABCDEF123456' } } } });
    render(<AdsCard base="/api/admin/ads" />);
    fireEvent.change(await screen.findByLabelText('TikTok pixel code'), { target: { value: 'CABCDEF123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ metaPixelId: '123456789012', tiktokPixelId: 'CABCDEF123456' });

    vi.unstubAllGlobals();
    mockFetch({ 'GET /api/admin/ads': { body: summary }, 'PUT /api/admin/ads': { status: 400, body: { error: 'bad' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not save'));
  });
});
