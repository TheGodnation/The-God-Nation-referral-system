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

function mockPushPlumbing(subscribeImpl?: () => Promise<any>) {
  const subscription = { endpoint: 'https://push.example/ep-1', keys: { p256dh: 'p', auth: 'a' }, toJSON: () => ({ endpoint: 'https://push.example/ep-1', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn() };
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(null),
    subscribe: subscribeImpl ?? vi.fn().mockResolvedValue(subscription),
  };
  const registration = { pushManager };
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(global.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  });
  return { pushManager };
}

function mockNotificationGlobal(initialPermission: NotificationPermission, requestResult: NotificationPermission) {
  const requestPermission = vi.fn().mockResolvedValue(requestResult);
  (global as any).Notification = { permission: initialPermission, requestPermission };
  return requestPermission;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (global as any).Notification;
  delete (global.navigator as any).serviceWorker;
  localStorage.clear();
});

describe('EnableNotificationsBanner', () => {
  it('renders nothing when the browser does not support Push', () => {
    delete (global as any).Notification;
    const { container } = render(<EnableNotificationsBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once permission has already been granted or denied', () => {
    mockNotificationGlobal('granted', 'granted');
    mockPushPlumbing();
    const { container } = render(<EnableNotificationsBanner />);
    expect(container).toBeEmptyDOMElement();
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

  it('hides itself (without subscribing) when the member denies the browser permission prompt', async () => {
    mockNotificationGlobal('default', 'denied');
    mockPushPlumbing();

    render(<EnableNotificationsBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
    });
  });

  it('can be dismissed, and stays dismissed across remounts', async () => {
    mockNotificationGlobal('default', 'granted');
    mockPushPlumbing();

    const { unmount } = render(<EnableNotificationsBanner />);
    fireEvent.click(await screen.findByLabelText('Close'));
    unmount();

    const { container: remounted } = render(<EnableNotificationsBanner />);
    expect(remounted).toBeEmptyDOMElement();
  });
});
