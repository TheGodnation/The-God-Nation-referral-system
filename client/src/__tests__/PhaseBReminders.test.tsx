import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InAppBrowserNotice, detectInAppBrowser, chromeIntentUrl } from '../components/InAppBrowserNotice';
import { RemindersCard } from '../components/admin/RemindersCard';
import { MemberReferralsPage } from '../pages/MemberReferralsPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import i18n from '../i18n';

// Phase B, client side: the "open in your browser" notice, the reminder emails
// switch, and the inviter's list of who needs a word.
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
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  sessionStorage.clear();
  i18n.changeLanguage('en');
});

const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]';
const IG_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

describe('Open in your browser notice', () => {
  it('recognises the built-in browsers of Facebook, Instagram and TikTok, and leaves real browsers alone', () => {
    expect(detectInAppBrowser(FB_ANDROID)).toMatchObject({ inApp: true, android: true });
    expect(detectInAppBrowser(IG_IPHONE)).toMatchObject({ inApp: true, ios: true });
    expect(detectInAppBrowser('Mozilla/5.0 (Linux; Android 12) TikTok 30.0 BytedanceWebview').inApp).toBe(true);
    expect(detectInAppBrowser(CHROME_ANDROID).inApp).toBe(false);
    expect(detectInAppBrowser(SAFARI_IPHONE).inApp).toBe(false);
  });

  it('on Android offers "Open in Chrome" for this very page, and can be dismissed for the visit', () => {
    render(<InAppBrowserNotice userAgent={FB_ANDROID} href="https://thegodnationacademy.org/member/join?utm_source=facebook" />);
    const open = screen.getByTestId('open-in-chrome') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe('intent://thegodnationacademy.org/member/join?utm_source=facebook#Intent;scheme=https;package=com.android.chrome;end');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('in-app-browser-notice')).toBeNull();
  });

  it('on iPhone explains how to open Safari instead (no Chrome button)', () => {
    render(<InAppBrowserNotice userAgent={IG_IPHONE} href="https://thegodnationacademy.org/" />);
    expect(screen.getByText(/Open in Safari/)).toBeInTheDocument();
    expect(screen.queryByTestId('open-in-chrome')).toBeNull();
  });

  it('shows nothing in a normal browser', () => {
    render(<InAppBrowserNotice userAgent={CHROME_ANDROID} href="https://thegodnationacademy.org/" />);
    expect(screen.queryByTestId('in-app-browser-notice')).toBeNull();
    expect(chromeIntentUrl('http://localhost:5173/x')).toContain('scheme=http;');
  });
});

describe('Reminder emails switch', () => {
  const SUMMARY = {
    enabled: false, quietDays: 7, dailyCap: 40, emailConfigured: true, sentToday: 2,
    last7: { FINISH_SIGNUP_1: 3, FINISH_SIGNUP_2: 1, FINISH_PROFILE: 0, WINBACK: 4 },
    pending: { FINISH_SIGNUP_1: 5, FINISH_SIGNUP_2: 2, FINISH_PROFILE: 1, WINBACK: 9 },
  };

  it('shows it is off, what is waiting and what went out, and saves a change', async () => {
    mockFetch({ 'GET /api/admin/reminders': { body: SUMMARY }, 'PUT /api/admin/reminders': { body: { ...SUMMARY, enabled: true, quietDays: 10 } } });
    render(<RemindersCard base="/api/admin/reminders" />);
    const on = (await screen.findByLabelText('Send reminder emails')) as HTMLInputElement;
    expect(on.checked).toBe(false);
    expect(screen.getByTestId('pending-WINBACK')).toHaveTextContent('9');
    expect(screen.getByText('Sent today: 2')).toBeInTheDocument();
    fireEvent.click(on);
    fireEvent.change(screen.getByLabelText('Days away before “We miss you”'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true, quietDays: 10, dailyCap: 40 });
  });

  it('warns when no email service is set up', async () => {
    mockFetch({ 'GET /api/admin/reminders': { body: { ...SUMMARY, emailConfigured: false } } });
    render(<RemindersCard base="/api/admin/reminders" />);
    expect(await screen.findByText(/No email service is set up/)).toBeInTheDocument();
  });
});

describe('My Referrals — who needs a word', () => {
  const ITEMS = [
    { personId: 'a', name: 'Ada', photoUrl: null, joinedAt: '2026-10-01T00:00:00Z', status: 'NOT_CONFIRMED', language: 'en', daysQuiet: null, whatsapp: '+237670000001' },
    { personId: 'b', name: 'Beau', photoUrl: null, joinedAt: '2026-10-02T00:00:00Z', status: 'QUIET', language: 'fr', daysQuiet: 12, whatsapp: '+237670000002' },
    { personId: 'c', name: 'Cora', photoUrl: null, joinedAt: '2026-10-03T00:00:00Z', status: 'ACTIVE', language: 'en', daysQuiet: null, whatsapp: '+237670000003' },
  ];
  function renderPage() {
    return render(
      <MemoryRouter>
        <MemberAuthProvider>
          <MemberReferralsPage />
        </MemberAuthProvider>
      </MemoryRouter>,
    );
  }
  const base = {
    '/api/member/auth/me': { body: { member: { name: 'Pastor Ben', email: 'b@x.com', preferredLanguage: 'en', profileComplete: true } } },
    '/api/member/referrals/links': { body: { referralCode: 'X', links: { en: 'https://x/join?ref=X&lang=en', fr: 'https://x/join?ref=X&lang=fr' } } },
  };

  it('shows each person’s status, filters to who needs a word, and gives leaders a WhatsApp message in the person’s language', async () => {
    mockFetch({ ...base, '/api/member/referrals/mine': { body: { items: ITEMS, summary: { NOT_CONFIRMED: 1, PROFILE_INCOMPLETE: 0, QUIET: 1, ACTIVE: 1 }, canSeeWhatsapp: true, quietDays: 7 } } });
    renderPage();
    expect(await screen.findByTestId('status-NOT_CONFIRMED')).toHaveTextContent('Not signed in yet');
    expect(screen.getByTestId('status-QUIET')).toHaveTextContent('Quiet 12 days');
    expect(screen.getByTestId('status-ACTIVE')).toHaveTextContent('Active');

    fireEvent.click(screen.getByTestId('filter-nudge'));
    expect(screen.queryByTestId('referred-c')).toBeNull();
    expect(screen.getByTestId('referred-a')).toBeInTheDocument();

    const waA = screen.getByTestId('nudge-whatsapp-a') as HTMLAnchorElement;
    expect(waA.href).toContain('https://wa.me/237670000001?text=');
    expect(decodeURIComponent(waA.href)).toContain('this is Pastor Ben from The God Nation');
    // Beau reads French: the message is in French.
    expect(decodeURIComponent((screen.getByTestId('nudge-whatsapp-b') as HTMLAnchorElement).href)).toContain('Vous nous manquez');
    // Nobody who is active gets a button.
    expect(screen.queryByTestId('nudge-whatsapp-c')).toBeNull();
  });

  it('for an ordinary member there is no WhatsApp button, only the in-app message', async () => {
    mockFetch({ ...base, '/api/member/referrals/mine': { body: { items: ITEMS.map(({ whatsapp, ...p }) => p), summary: { NOT_CONFIRMED: 1, PROFILE_INCOMPLETE: 0, QUIET: 1, ACTIVE: 1 }, canSeeWhatsapp: false, quietDays: 7 } } });
    renderPage();
    await screen.findByTestId('referred-a');
    expect(screen.queryByTestId('nudge-whatsapp-a')).toBeNull();
    expect(within(screen.getByTestId('referred-a')).getByRole('link', { name: 'Message in the app' })).toHaveAttribute('href', '/member/people/a');
  });
});
