import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('WhatsApp group step', () => {
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

  it('offers the group link, notes the tap, and lets them continue or skip', async () => {
    mockFetch({
      '/api/settings/public': { body: { content: {}, whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENG', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRA' } },
      'POST /api/member/group-link-click': { body: { ok: true } },
    });
    renderStep();
    const join = (await screen.findByTestId('join-group-button')) as HTMLAnchorElement;
    expect(join.href).toBe('https://chat.whatsapp.com/ENG');
    fireEvent.click(join);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/member/group-link-click'))).toBe(true));
    fireEvent.click(screen.getByTestId('join-group-continue'));
    expect(await screen.findByText('Chats page')).toBeInTheDocument();
  });

  it('uses the French group for a French member', async () => {
    await i18n.changeLanguage('fr');
    mockFetch({ '/api/settings/public': { body: { content: {}, whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENG', whatsappGroupFrUrl: 'https://chat.whatsapp.com/FRA' } } });
    renderStep();
    expect(((await screen.findByTestId('join-group-button')) as HTMLAnchorElement).href).toBe('https://chat.whatsapp.com/FRA');
  });

  it('goes straight into the app when no group link is set', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } } });
    renderStep();
    expect(await screen.findByText('Chats page')).toBeInTheDocument();
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
        },
      },
    });
    render(<GrowthPanel base="/api/admin/growth" />);
    expect(await screen.findByTestId('growth-total-registered')).toHaveTextContent('12');
    expect(screen.getByTestId('growth-total-visitors')).toHaveTextContent('40');
    expect(screen.getByText('facebook')).toBeInTheDocument();
    expect(screen.getByText('nov')).toBeInTheDocument();
    expect(screen.getByText('Ambassador Ann')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/admin/growth?days=90'))).toBe(true));
  });

  it('says when nobody joined yet', async () => {
    mockFetch({ '/api/member/central-growth': { body: { days: 30, totals: { ...TOTALS, registered: 0 }, truncated: false, bySource: [], byAmbassador: [] } } });
    render(<GrowthPanel base="/api/member/central-growth" />);
    expect(await screen.findByText('Nobody joined in this period yet.')).toBeInTheDocument();
  });
});
