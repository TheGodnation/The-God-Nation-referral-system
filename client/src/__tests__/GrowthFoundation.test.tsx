import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberSignupPage } from '../pages/MemberSignupPage';
import { MemberJoinGroupPage } from '../pages/MemberJoinGroupPage';
import { StayConnected } from '../components/StayConnected';
import { ContactPreferencesCard } from '../components/member/ContactPreferencesCard';
import { GrowthPanel } from '../components/admin/GrowthPanel';
import { visitDetails, recordLandingVisitOnce } from '../lib/trackVisit';
import i18n from '../i18n';

// Phase A of the growth foundation, client side: visit details, the stay
// connected box, the consent boxes, the member's own contact choices, the
// WhatsApp group step, and the growth report.
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

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  localStorage.clear();
  i18n.changeLanguage('en');
});

describe('visit details', () => {
  it('reads the ad codes, the campaign details and the page they came from', () => {
    const d = visitDetails('?utm_source=facebook&utm_campaign=nov&utm_content=v1&fbclid=abc&ref=MARY&lang=fr', 'https://l.facebook.com/x', '/');
    expect(d).toMatchObject({ utmSource: 'facebook', utmCampaign: 'nov', utmContent: 'v1', fbclid: 'abc', ref: 'MARY', lang: 'fr', referrer: 'https://l.facebook.com/x', landingPage: '/?utm_source=facebook&utm_campaign=nov&utm_content=v1&fbclid=abc&ref=MARY&lang=fr' });
    expect(visitDetails('', '', '/').referrer).toBeUndefined();
  });

  it('records the first visit, then only visits that come with ad details', async () => {
    mockFetch({ 'POST /api/referrals/visit': { status: 201, body: { ok: true } } });
    const visits = () => calls.filter((c) => c.url.includes('/api/referrals/visit')).length;

    window.history.pushState({}, '', '/');
    recordLandingVisitOnce();
    await waitFor(() => expect(visits()).toBe(1));

    // A member coming back on their own: not counted again.
    recordLandingVisitOnce();
    await new Promise((r) => setTimeout(r, 20));
    expect(visits()).toBe(1);

    // An ad click: counted, with its details.
    window.history.pushState({}, '', '/?utm_source=tiktok&ttclid=zz');
    recordLandingVisitOnce();
    await waitFor(() => expect(visits()).toBe(2));
    expect(calls.filter((c) => c.url.includes('/api/referrals/visit'))[1].body).toMatchObject({ utmSource: 'tiktok', ttclid: 'zz' });

    // The referral pages record their own visit.
    window.history.pushState({}, '', '/join?ref=MARY');
    recordLandingVisitOnce();
    await new Promise((r) => setTimeout(r, 20));
    expect(visits()).toBe(2);
    window.history.pushState({}, '', '/');
  });
});

describe('Stay connected box', () => {
  it('will not send anything without the tick, then sends the name, number and agreement', async () => {
    mockFetch({ '/api/leads': { body: { ok: true } } });
    render(<StayConnected />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Paul' } });
    fireEvent.change(screen.getByLabelText('Your WhatsApp number'), { target: { value: '+237670000009' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep me connected' }));
    expect(await screen.findByText(/tick the box/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/api/leads'))).toBe(false);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep me connected' }));
    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/api/leads'))?.body).toEqual({ name: 'Paul', whatsapp: '+237670000009', language: 'en', consentWhatsapp: true });
  });

  it('says when the number is not valid, and works in French', async () => {
    await i18n.changeLanguage('fr');
    mockFetch({ '/api/leads': { status: 400, body: { error: 'x', code: 'INVALID_PHONE' } } });
    render(<StayConnected />);
    fireEvent.change(screen.getByLabelText('Votre nom'), { target: { value: 'Paul' } });
    fireEvent.change(screen.getByLabelText('Votre numéro WhatsApp'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Gardons le contact' }));
    expect(await screen.findByText(/numéro de téléphone valide/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/api/leads'))?.body.language).toBe('fr');
  });
});

describe('Sign-up consent boxes', () => {
  it('are not ticked to begin with, and what is ticked is sent', async () => {
    mockFetch({ '/api/member/auth/signup': { body: { message: 'ok' } } });
    render(<MemoryRouter><MemberSignupPage /></MemoryRouter>);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone number (WhatsApp)'), { target: { value: '+237670000001' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Testpass123' } });
    fireEvent.click(screen.getByLabelText(/updates and encouragement from The God Nation on WhatsApp/));
    fireEvent.click(screen.getByRole('button', { name: 'Send me the link' }));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    expect(calls.find((c) => c.url.includes('/api/member/auth/signup'))?.body).toMatchObject({ consentWhatsapp: true, consentEmail: false });
  });
});

describe('Contact preferences card', () => {
  it('shows what is chosen, saves a change at once, and says so', async () => {
    mockFetch({
      'GET /api/member/contact-consent': { body: { whatsapp: true, email: null } },
      'PUT /api/member/contact-consent': { body: { whatsapp: false, email: null } },
    });
    render(<ContactPreferencesCard />);
    const wa = (await screen.findByLabelText('Send me updates on WhatsApp')) as HTMLInputElement;
    expect(wa.checked).toBe(true);
    expect(screen.getByText('(Not answered yet)')).toBeInTheDocument();
    fireEvent.click(wa);
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ whatsapp: false });
    expect((screen.getByLabelText('Send me updates on WhatsApp') as HTMLInputElement).checked).toBe(false);
  });
});

describe('Join us where you prefer (the step after sign-up)', () => {
  const PLACES = {
    content: {},
    whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENG',
    whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRA',
    whatsappChannelUrl: 'https://whatsapp.com/channel/CH',
    telegramGroupUrl: 'https://t.me/group',
    telegramUrl: 'https://t.me/channel',
    messengerUrl: 'https://m.me/j/XYZ',
    facebookGroupUrl: 'https://facebook.com/groups/g',
    facebookUrl: 'https://facebook.com/page',
    instagramUrl: 'https://instagram.com/gn',
  };

  function renderStep() {
    return render(
      <MemoryRouter initialEntries={['/member/welcome-group']}>
        <Routes>
          <Route path="/member/welcome-group" element={<MemberJoinGroupPage />} />
          <Route path="/member/chats" element={<p>Chats page</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lists every place that is set up, the person’s own-language WhatsApp group first, and the pages to follow', async () => {
    mockFetch({ '/api/settings/public': { body: PLACES } });
    renderStep();
    const first = await screen.findByTestId('place-whatsapp_group_en');
    const places = within(screen.getByTestId('community-choices')).getAllByRole('link');
    expect(places[0]).toBe(first);
    for (const p of ['whatsapp_group_fr', 'whatsapp_channel', 'telegram_group', 'telegram_channel', 'messenger', 'facebook_group', 'facebook', 'instagram']) {
      expect(screen.getByTestId(`place-${p}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('place-tiktok')).toBeNull();
    expect(screen.getByTestId('place-telegram_group')).toHaveAttribute('href', 'https://t.me/group');
  });

  it('notes which place was tapped, and then lets them continue', async () => {
    mockFetch({ '/api/settings/public': { body: PLACES }, 'POST /api/member/group-link-click': { body: { ok: true } } });
    renderStep();
    fireEvent.click(await screen.findByTestId('place-telegram_channel'));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/api/member/group-link-click'))?.body).toEqual({ platform: 'telegram_channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the app' }));
    expect(await screen.findByText('Chats page')).toBeInTheDocument();
  });

  it('puts the French WhatsApp group first for a French member, and can be skipped', async () => {
    await i18n.changeLanguage('fr');
    mockFetch({ '/api/settings/public': { body: PLACES } });
    renderStep();
    await screen.findByTestId('place-whatsapp_group_fr');
    expect(within(screen.getByTestId('community-choices')).getAllByRole('link')[0]).toBe(screen.getByTestId('place-whatsapp_group_fr'));
    fireEvent.click(screen.getByRole('button', { name: 'Pas maintenant' }));
    expect(await screen.findByText('Chats page')).toBeInTheDocument();
  });

  it('goes straight into the app when nothing is set up', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } } });
    renderStep();
    expect(await screen.findByText('Chats page')).toBeInTheDocument();
  });
});

describe('Stay connected, after leaving a number', () => {
  it('offers the places to join and counts the tap without needing an account', async () => {
    mockFetch({
      '/api/settings/public': { body: { content: {}, whatsappChannelUrl: 'https://whatsapp.com/channel/CH', telegramUrl: 'https://t.me/channel' } },
      'POST /api/leads/click': { body: { ok: true } },
      'POST /api/leads': { body: { ok: true } },
    });
    render(<StayConnected />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Paul' } });
    fireEvent.change(screen.getByLabelText('Your WhatsApp number'), { target: { value: '+237670000009' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep me connected' }));
    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('place-telegram_channel'));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/api/leads/click'))?.body).toEqual({ platform: 'telegram_channel' }));
  });
});

describe('Growth report', () => {
  const TOTALS = { visitors: 40, leads: 5, registered: 12, confirmed: 9, profileCompleted: 7, joinedGroup: 4, firstChat: 3, firstExam: 2, returned7: 5, returned30: 1 };

  it('shows the totals, the rows by source and campaign, and the ambassadors; changing the period asks again', async () => {
    mockFetch({
      '/api/admin/growth': {
        body: {
          days: 30, totals: TOTALS, truncated: false,
          bySource: [{ key: 'facebook|nov', source: 'facebook', campaign: 'nov', ...TOTALS }],
          byAmbassador: [{ name: 'Ambassador Ann', registered: 3, confirmed: 2, profileCompleted: 2, returned7: 1 }],
          byPlatform: [{ platform: 'telegram_channel', taps: 7 }, { platform: 'unknown', taps: 1 }],
        },
      },
    });
    render(<GrowthPanel base="/api/admin/growth" />);
    expect(await screen.findByTestId('growth-total-registered')).toHaveTextContent('12');
    expect(screen.getByTestId('growth-total-visitors')).toHaveTextContent('40');
    expect(screen.getByText('facebook')).toBeInTheDocument();
    expect(screen.getByText('nov')).toBeInTheDocument();
    expect(screen.getByText('Ambassador Ann')).toBeInTheDocument();
    expect(screen.getByTestId('growth-platform-telegram_channel')).toHaveTextContent('Telegram channel');
    expect(screen.getByTestId('growth-platform-telegram_channel')).toHaveTextContent('7');
    expect(screen.getByTestId('growth-platform-unknown')).toHaveTextContent('Not recorded');

    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/admin/growth?days=90'))).toBe(true));
  });

  it('says when nobody joined yet', async () => {
    mockFetch({ '/api/member/central-growth': { body: { days: 30, totals: { ...TOTALS, registered: 0 }, truncated: false, bySource: [], byAmbassador: [] } } });
    render(<GrowthPanel base="/api/member/central-growth" />);
    expect(await screen.findByText('Nobody joined in this period yet.')).toBeInTheDocument();
  });
});
