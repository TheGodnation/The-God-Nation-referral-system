import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GetStartedCard, OnboardingPage } from '../components/member/OnboardingChecklist';
import i18n from '../i18n';

// The welcome checklist and the "Get started" card: they always appear, show real progress, never block, and the
// card can be closed for good.
const calls: { url: string; method: string; body: any }[] = [];
const STATUS = { profileDone: true, notificationsOn: false, communityTapped: false, firstTeachingOpened: false, dismissed: false, firstSignInAt: '2026-01-01T00:00:00Z' };

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
    mockFetch({ '/api/member/onboarding': { body: { ...STATUS, communityTapped: true } } });
    card();
    expect(await screen.findByTestId('get-started-card')).toBeInTheDocument();
    expect(screen.getByTestId('get-started-progress')).toHaveTextContent('1 of 4 done');
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
    mockFetch({ '/api/member/onboarding': { body: { ...STATUS, notificationsOn: true, communityTapped: true, firstTeachingOpened: true } } });
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
    expect(screen.getByTestId('get-started-progress')).toHaveTextContent('0 sur 4 terminées');
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
    for (const s of ['notifications', 'install', 'community', 'teaching']) expect(await screen.findByTestId(`step-${s}`)).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('0 of 4 done');
  });

  it('marks a step done from what the server knows', async () => {
    mockFetch({ '/api/settings/public': { body: { content: {} } }, '/api/member/onboarding': { body: { ...STATUS, firstTeachingOpened: true, communityTapped: true } } });
    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('2 of 4 done'));
  });
});
