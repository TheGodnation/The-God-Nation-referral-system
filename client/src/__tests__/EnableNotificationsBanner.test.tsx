import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EnableNotificationsBanner } from '../components/member/EnableNotificationsBanner';

function mockFetch(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const key = Object.keys(responses).find((k) => {
        const [m, path] = k.split(' ');
        return m === method && url.includes(path);
      });
      const res = key ? responses[key] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

function mockPushPlumbing({ alreadySubscribed = false }: { alreadySubscribed?: boolean } = {}) {
  const subscription = { endpoint: 'https://push.example/ep-1', keys: { p256dh: 'p', auth: 'a' }, toJSON: () => ({ endpoint: 'https://push.example/ep-1', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn() };
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(alreadySubscribed ? subscription : null),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  const registration = { pushManager };
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(global.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) },
  });
  return { pushManager };
}

function mockUserAgent(ua: string) {
  Object.defineProperty(global.navigator, 'userAgent', { configurable: true, value: ua });
}

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function mockNotificationGlobal(initialPermission: NotificationPermission, requestResult: NotificationPermission) {
  const requestPermission = vi.fn().mockResolvedValue(requestResult);
  (global as any).Notification = { permission: initialPermission, requestPermission };
  return requestPermission;
}

const ORIGINAL_UA = navigator.userAgent;

afterEach(() => {
  vi.unstubAllGlobals();
  delete (global as any).Notification;
  delete (global.navigator as any).serviceWorker;
  mockUserAgent(ORIGINAL_UA);
  localStorage.clear();
  sessionStorage.clear();
});

describe('EnableNotificationsBanner', () => {
  it('says what to do (no button) when the browser cannot receive notifications at all', async () => {
    delete (global as any).Notification;
    render(<EnableNotificationsBanner />);
    expect(await screen.findByText(/This browser can't receive notifications/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
  });

  it('tells an iPhone user in Safari to add the app to the Home Screen first', async () => {
    delete (global as any).Notification;
    mockUserAgent(IPHONE_SAFARI);
    render(<EnableNotificationsBanner />);
    expect(await screen.findByText(/only work from the app on your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
  });

  it('renders nothing once this device is really subscribed, and re-confirms the subscription with the server', async () => {
    mockNotificationGlobal('granted', 'granted');
    mockPushPlumbing({ alreadySubscribed: true });
    mockFetch({ 'POST /push/subscribe': { status: 201, body: { ok: true } } });
    const { container } = render(<EnableNotificationsBanner />);
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('/push/subscribe') && init?.method === 'POST')).toBe(true);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps asking when "Allow" was granted but this device has no push subscription', async () => {
    mockNotificationGlobal('granted', 'granted');
    mockPushPlumbing({ alreadySubscribed: false });
    render(<EnableNotificationsBanner />);
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument();
  });

  it('keeps showing a "blocked" message (no button) when permission was already denied at the browser level', async () => {
    mockNotificationGlobal('denied', 'denied');
    mockPushPlumbing();
    render(<EnableNotificationsBanner />);
    expect(await screen.findByText(/blocked on this device/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
  });

  it('prompts, subscribes, and hides itself once the member enables notifications', async () => {
    mockNotificationGlobal('default', 'granted');
    mockPushPlumbing();
    mockFetch({
      'GET /push/vapid-public-key': { status: 200, body: { configured: true, publicKey: 'BPUBLICKEYVALUE' } },
      'POST /push/subscribe': { status: 201, body: { ok: true } },
    });

    render(<EnableNotificationsBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));

    await waitFor(() => {
      expect(screen.queryByText('Get notified about new messages, announcements and updates — even when the app is closed.')).not.toBeInTheDocument();
    });
  });

  it('shows an error and stays visible if the server has no VAPID keys configured', async () => {
    mockNotificationGlobal('default', 'granted');
    mockPushPlumbing();
    mockFetch({
      'GET /push/vapid-public-key': { status: 200, body: { configured: false, publicKey: null } },
    });

    render(<EnableNotificationsBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));

    expect(await screen.findByText('Could not turn on notifications. Please try again.')).toBeInTheDocument();
  });

  it('switches to the "blocked" message (no button) when the member denies the browser permission prompt', async () => {
    mockNotificationGlobal('default', 'denied');
    mockPushPlumbing();

    render(<EnableNotificationsBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/blocked on this device/)).toBeInTheDocument();
  });

  it('stays closed while moving between pages in the same visit, and comes back on the next visit', async () => {
    mockNotificationGlobal('default', 'granted');
    mockPushPlumbing();

    const first = render(<EnableNotificationsBanner />);
    fireEvent.click(await screen.findByLabelText('Hide for now'));
    first.unmount();

    // Another page in the same visit.
    const second = render(<EnableNotificationsBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();

    // Next visit: the app was closed and reopened.
    sessionStorage.clear();
    render(<EnableNotificationsBanner />);
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument();
  });
});
