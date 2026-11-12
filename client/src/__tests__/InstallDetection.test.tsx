import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstallAppBanner } from '../components/member/InstallAppBanner';
import { OnboardingPage } from '../components/member/OnboardingChecklist';
import { checkInstalledRelatedApps, rememberInstalled, useInstallPrompt } from '../lib/installPrompt';
import i18n from '../i18n';

// How the app knows the app is installed: running as the app, the browser saying so (Chrome on Android), or the member
// saying so. A normal browser tab cannot see it on its own, so there is always a way to say "I already installed it".
const calls: { url: string; method: string }[] = [];
const STATUS = { profileDone: true, notificationsOn: false, communityTapped: false, existingMember: true, agreementCommunityId: null, dismissed: false, installed: false, firstSignInAt: null };

function mockFetch(status: Record<string, unknown> = STATUS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const body = url.includes('/api/member/onboarding') && method === 'GET' ? status : url.includes('/api/settings/public') ? { content: {} } : { ok: true };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
    }),
  );
}

const UA = window.navigator.userAgent;
const setUa = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUa(UA);
  calls.length = 0;
  localStorage.clear();
  delete (navigator as any).getInstalledRelatedApps;
});

function Probe() {
  const { installed } = useInstallPrompt();
  return <p data-testid="probe">{installed ? 'installed' : 'not installed'}</p>;
}

describe('Knowing the app is installed', () => {
  it('Chrome on Android can say so from a browser tab, and it is remembered', async () => {
    (navigator as any).getInstalledRelatedApps = vi.fn(async () => [{ platform: 'webapp', url: 'https://thegodnationacademy.org/manifest.webmanifest' }]);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('not installed');
    await act(async () => {
      expect(await checkInstalledRelatedApps()).toBe(true);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('installed');
    expect(localStorage.getItem('godnation:installed')).toBe('1');
  });

  it('stays "not installed" when the browser cannot say, or says it is not there', async () => {
    expect(await checkInstalledRelatedApps()).toBe(false);
    (navigator as any).getInstalledRelatedApps = vi.fn(async () => []);
    expect(await checkInstalledRelatedApps()).toBe(false);
    (navigator as any).getInstalledRelatedApps = vi.fn(async () => {
      throw new Error('not allowed');
    });
    expect(await checkInstalledRelatedApps()).toBe(false);
    expect(localStorage.getItem('godnation:installed')).toBeNull();
  });

  it('the install banner (iPhone, where nothing can be detected) goes away when the member says "Already installed"', async () => {
    setUa(IPHONE);
    mockFetch();
    render(<InstallAppBanner />);
    expect(screen.getByText('Install the God Nation app')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('install-banner-already'));
    await waitFor(() => expect(screen.queryByText('Install the God Nation app')).toBeNull());
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/member/onboarding/installed'))).toBe(true);
  });

  it('the banner never shows once the phone is known to have the app', () => {
    setUa(IPHONE);
    rememberInstalled();
    render(<InstallAppBanner />);
    expect(screen.queryByText('Install the God Nation app')).toBeNull();
  });
});

describe('The install step of the welcome page', () => {
  const page = () => render(<MemoryRouter><OnboardingPage /></MemoryRouter>);

  it('"I have already installed it" ticks the step and tells the server', async () => {
    setUa(ANDROID);
    mockFetch();
    page();
    fireEvent.click(await screen.findByTestId('install-already'));
    await waitFor(() => expect(screen.getByTestId('step-install')).toHaveTextContent('Done'));
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/member/onboarding/installed'))).toBe(true);
  });

  it('is ticked on this phone when the server already knows (the app was opened as the app on another visit)', async () => {
    setUa(ANDROID);
    mockFetch({ ...STATUS, installed: true });
    page();
    await waitFor(() => expect(screen.getByTestId('step-install')).toHaveTextContent('Done'));
    expect(localStorage.getItem('godnation:installed')).toBe('1');
    // The banner on the Chats page stops asking too.
    const banner = render(<InstallAppBanner />);
    expect(banner.container.textContent).toBe('');
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    setUa(ANDROID);
    mockFetch();
    page();
    expect(await screen.findByRole('button', { name: 'J’ai déjà installé l’application' })).toBeInTheDocument();
  });
});
