import { describe, it, expect, vi, afterEach } from 'vitest';

// Tapping "Turn on notifications" must feel instant: the server's key is fetched ahead of time, the screen
// says "on" the moment Allow is tapped, and the slow network part finishes behind it.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete (global as any).Notification;
  delete (global.navigator as any).serviceWorker;
});

function setup(subscribe: () => Promise<unknown>) {
  const subscription = { toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }) };
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn(subscribe.bind(null)) } };
  void subscription;
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(global.navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) } });
  (global as any).Notification = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') };
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ configured: true, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }) };
  }));
  return { registration, calls, subscription };
}

describe('turning on notifications is quick', () => {
  it('says "granted" at once and finishes the subscription behind it', async () => {
    const { registration, calls, subscription } = setup(async () => subscription);
    registration.pushManager.subscribe = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return subscription;
    });
    const { enablePushNotifications } = await import('../lib/push');
    const order: string[] = [];
    const result = await enablePushNotifications({ onGranted: () => order.push('granted') }).then((r) => {
      order.push('finished');
      return r;
    });
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(['granted', 'finished']);
    expect(calls.filter((c) => c.includes('vapid-public-key'))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/push/subscribe'))).toBe(true);
  });

  it('asks for the server key only once, however often it is prefetched or used', async () => {
    const { calls } = setup(async () => ({ toJSON: () => ({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }) }));
    const { prefetchPushKey, enablePushNotifications } = await import('../lib/push');
    await prefetchPushKey();
    await prefetchPushKey();
    await enablePushNotifications();
    expect(calls.filter((c) => c.includes('vapid-public-key'))).toHaveLength(1);
  });

  it('tries the subscription a second time when the first one fails', async () => {
    const sub = { toJSON: () => ({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }) };
    const { registration } = setup(async () => sub);
    registration.pushManager.subscribe = vi.fn().mockRejectedValueOnce(new Error('slow network')).mockResolvedValueOnce(sub);
    const { enablePushNotifications } = await import('../lib/push');
    expect(await enablePushNotifications()).toEqual({ ok: true });
    expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(2);
  });
});
