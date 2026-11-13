import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CommunityJoinCard, GetStartedCard, OnboardingPage } from '../components/member/OnboardingChecklist';
import { resetPublicSettingsCacheForTests } from '../lib/usePublicSettings';
import i18n from '../i18n';

// The welcome checklist and the "Get started" card: they always appear, show real progress, never block, and the
// card can be closed for good.
const calls: { url: string; method: string; body: any }[] = [];
const STATUS = { profileDone: true, notificationsOn: false, communityTapped: false, existingMember: false, agreementCommunityId: 'c1', dismissed: false, firstSignInAt: '2026-01-01T00:00:00Z' };

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

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const card = () =>
  render(
    <MemoryRouter initialEntries={['/member/chats']}>
      <Routes>
        <Route path="/member/chats" element={<GetStartedCard />} />
        <Route path="/member/welcome-group" element={<p>Welcome steps</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Get started card', () => {
  it('shows progress and the next step, and continues to the welcome steps', async () => {
    mockFetch({ '/api/member/onboarding': { body: { ...STATUS, communityConfirmed: true } } });
    card();
    expect(await screen.findByTestId('get-started-card')).toBeInTheDocument();
    expect(screen.getByTestId('get-started-progress')).toHaveTextContent('1 of 3 done');
    expect(screen.getByText(/Next: turn on notifications/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('get-started-continue'));
    expect(await screen.findByText('Welcome steps')).toBeInTheDocument();
  });

  it('can be closed, and tells the server so', async () => {
    mockFetch({ '/api/member/onboarding': { body: STATUS }, 'POST /api/member/onboarding/dismiss': { body: { ok: true } } });
    card();
    fireEvent.click(await screen.findByTestId('get-started-close'));
    expect(screen.queryByTestId('get-started-card')).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/member/onboarding/dismiss'))).toBe(true));
  });

  it('stays away once closed before, once everything is done, and when the status cannot be read', async () => {
    mockFetch({ '/api/member/onboarding': { body: { ...STATUS, dismissed: true } } });
    const a = card();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('get-started-card')).toBeNull();
    a.unmount();

    vi.unstubAllGlobals();
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    mockFetch({ '/api/member/onboarding': { body: { ...STATUS, notificationsOn: true, communityConfirmed: true, agreementCommunityId: null } } });
    const b = card();
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(screen.queryByTestId('get-started-card')).toBeNull();
    b.unmount();
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });

    vi.unstubAllGlobals();
    mockFetch({});
    card();
    await waitFor(() => expect(calls.length).toBeGreaterThan(2));
    expect(screen.queryByTestId('get-started-card')).toBeNull();
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    mockFetch({ '/api/member/onboarding': { body: STATUS } });
    card();
    expect(await screen.findByText('Pour bien commencer')).toBeInTheDocument();
    expect(screen.getByTestId('get-started-progress')).toHaveTextContent('0 sur 3 terminées');
  });
});

describe('Existing members and the steps', () => {
  const page = () => render(<MemoryRouter><OnboardingPage /></MemoryRouter>);

  it('has three steps only: the assembly rules are agreed inside the assembly, not here', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: STATUS } });
    page();
    expect(await screen.findByTestId('step-community')).toBeInTheDocument();
    expect(screen.getByText('Three small steps you can do.')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('0 of 3 done');
    expect(screen.queryByTestId('step-agreement')).toBeNull();
    expect(screen.queryByTestId('open-assembly')).toBeNull();
    expect(screen.queryByText(/rules/i)).toBeNull();
  });

  it('an existing member has the community step ticked already', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: { ...STATUS, existingMember: true, agreementCommunityId: null } } });
    page();
    await waitFor(() => expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('1 of 3 done'));
    expect(screen.queryByTestId('open-assembly')).toBeNull();
  });

  it('the card is gone once the three steps are done (nothing about rules is left to do)', async () => {
    mockFetch({ '/api/member/onboarding': { body: { ...STATUS, notificationsOn: true, installed: true, communityConfirmed: true } } });
    card();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/member/onboarding'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('get-started-card')).toBeNull();
  });
});

describe('Welcome steps page', () => {
  it('shows every step with real progress, even when the status cannot be read', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } } });
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    for (const s of ['notifications', 'install', 'community']) expect(await screen.findByTestId(`step-${s}`)).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('0 of 3 done');
  });

  it('marks a step done from what the server knows', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: { ...STATUS, agreementCommunityId: null, communityConfirmed: true } } });
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('1 of 3 done'));
  });
});

describe('YouTube is left out of the welcome step', () => {
  it('shows the other places but not YouTube, and treats YouTube alone as "no places"', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {}, telegramGroupUrl: 'https://t.me/g', youtubeUrl: 'https://youtube.com/@gn', facebookUrl: 'https://facebook.com/gn' } } });
    const a = render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
    expect(await screen.findByTestId('place-telegram_group')).toBeInTheDocument();
    expect(screen.getByTestId('place-facebook')).toBeInTheDocument();
    expect(screen.queryByTestId('place-youtube')).toBeNull();
    a.unmount();
    vi.unstubAllGlobals();
    resetPublicSettingsCacheForTests();
    mockFetch({ '/api/settings/public': { body: { content: {}, youtubeUrl: 'https://youtube.com/@gn' } } });
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
    expect(await screen.findByTestId('no-places')).toBeInTheDocument();
    expect(screen.queryByTestId('place-youtube')).toBeNull();
  });
});

describe('Install step roadmap', () => {
  const setUa = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  const ORIGINAL = window.navigator.userAgent;
  afterEach(() => setUa(ORIGINAL));
  const page = () => render(<MemoryRouter><OnboardingPage /></MemoryRouter>);

  it('gives numbered steps for an Android phone', async () => {
    setUa('Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    mockFetch({ '/api/settings/public': { body: { content: {} } } });
    page();
    const steps = await screen.findByTestId('install-steps-android');
    expect(steps.querySelectorAll('li')).toHaveLength(4);
    expect(steps.textContent).toMatch(/three dots/);
    expect(screen.queryByTestId('install-inapp')).toBeNull();
  });

  it('gives Safari steps for an iPhone', async () => {
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1');
    mockFetch({ '/api/settings/public': { body: { content: {} } } });
    page();
    const steps = await screen.findByTestId('install-steps-ios');
    expect(steps.querySelectorAll('li')).toHaveLength(5);
    expect(steps.textContent).toMatch(/Add to Home Screen/);
  });

  it('warns when opened inside another app, and speaks French', async () => {
    await i18n.changeLanguage('fr');
    setUa('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0]');
    mockFetch({ '/api/settings/public': { body: { content: {} } } });
    page();
    expect(await screen.findByTestId('install-inapp')).toHaveTextContent('Ouvrir dans Chrome');
    expect(screen.getByTestId('install-steps-android').textContent).toMatch(/trois points/);
  });

  it('tells the server once when the app is seen installed, and ticks the step from the server on any device', async () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: STATUS }, 'POST /api/member/onboarding/installed': { body: { ok: true } } });
    page();
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/onboarding/installed'))).toHaveLength(1));
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    vi.unstubAllGlobals();
    calls.length = 0;
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: { ...STATUS, installed: true } } });
    page();
    await waitFor(() => expect(screen.getAllByTestId('onboarding-progress').pop()).toHaveTextContent('1 of 3 done'));
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/onboarding/installed'))).toBe(false);
  });
});


describe('Joining the community: a tap is not joining', () => {
  const PLACES = { content: {}, whatsappGroupEnUrl: 'https://chat.whatsapp.com/ENG', telegramGroupUrl: 'https://t.me/g' };
  const page = () => render(<MemoryRouter><OnboardingPage /></MemoryRouter>);

  it('a tap alone does not tick the step; it asks, and "I have joined" does', async () => {
    mockFetch({
      '/api/settings/public': { body: PLACES },
      '/api/member/onboarding': { body: STATUS },
      'POST /api/member/group-link-click': { body: { ok: true } },
      'POST /api/member/onboarding/community-joined': { body: { ok: true } },
    });
    page();
    expect(screen.queryByTestId('confirm-joined-box')).toBeNull();
    fireEvent.click(await screen.findByTestId('place-whatsapp_group_en'));
    expect(await screen.findByTestId('confirm-joined-box')).toHaveTextContent('We cannot see whether you joined');
    expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('0 of 3 done');
    fireEvent.click(screen.getByTestId('confirm-joined'));
    await waitFor(() => expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('1 of 3 done'));
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/onboarding/community-joined'))).toBe(true);
    expect(screen.queryByTestId('confirm-joined-box')).toBeNull();
  });

  it('a link tapped earlier (another visit) still gets the question', async () => {
    mockFetch({ '/api/settings/public': { body: PLACES }, '/api/member/onboarding': { body: { ...STATUS, communityTapped: true } } });
    page();
    expect(await screen.findByTestId('confirm-joined-box')).toBeInTheDocument();
  });

  it('shows the places on Chats for a new member, until they say they joined or close it', async () => {
    mockFetch({ '/api/settings/public': { body: PLACES }, '/api/member/onboarding': { body: STATUS } });
    const a = render(<MemoryRouter><CommunityJoinCard /></MemoryRouter>);
    expect(await screen.findByTestId('community-join-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('community-card-close'));
    expect(screen.queryByTestId('community-join-card')).toBeNull();
    a.unmount();
    localStorage.clear();
    vi.unstubAllGlobals();
    calls.length = 0;
    mockFetch({ '/api/settings/public': { body: PLACES }, '/api/member/onboarding': { body: { ...STATUS, communityConfirmed: true } } });
    render(<MemoryRouter><CommunityJoinCard /></MemoryRouter>);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/member/onboarding'))).toBe(true));
    expect(screen.queryByTestId('community-join-card')).toBeNull();
  });

  it('is not shown to existing members, or when no places are set up', async () => {
    mockFetch({ '/api/settings/public': { body: PLACES }, '/api/member/onboarding': { body: { ...STATUS, existingMember: true, agreementCommunityId: null } } });
    const a = render(<MemoryRouter><CommunityJoinCard /></MemoryRouter>);
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(screen.queryByTestId('community-join-card')).toBeNull();
    a.unmount();
    vi.unstubAllGlobals();
    resetPublicSettingsCacheForTests();
    calls.length = 0;
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: STATUS } });
    render(<MemoryRouter><CommunityJoinCard /></MemoryRouter>);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/member/onboarding'))).toBe(true));
    expect(screen.queryByTestId('community-join-card')).toBeNull();
  });
});
