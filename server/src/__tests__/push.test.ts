import { describe, it, expect, vi, afterEach } from 'vitest';
import webpushForKeygen from 'web-push';
import { prisma } from '../lib/prisma';

// A real key PAIR (not an arbitrary string) is required here — web-push's
// own setVapidDetails validates the public key's shape at call time, and
// lib/push.ts calls it eagerly at module load whenever both env vars are
// non-empty. Generated once, reused by every "configured" test below.
const VAPID_KEYS = webpushForKeygen.generateVAPIDKeys();

// lib/push.ts reads VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY at module-load time
// (that's how the `web-push` library itself wants to be configured), so
// "configured" vs "unconfigured" behavior can only be exercised by
// resetting the module registry and re-importing with different env vars
// set first — a plain top-level import can only ever see one of the two
// states for the whole file.

const ORIGINAL_ENV = { ...process.env };

async function freshPushModule(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../lib/push');
}

describe('lib/push — Web Push (background/closed-app delivery)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('is unconfigured, and silently no-ops, with no VAPID keys set', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' });
    expect(push.isPushConfigured()).toBe(false);
    expect(push.vapidPublicKey()).toBeNull();

    const community = await prisma.community.create({ data: { name: 'Push Unconfigured Community' } });
    const person = await prisma.person.create({ data: { name: 'Push Target', whatsappNumber: '+237699200001' } });
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id } });
    await prisma.pushSubscription.create({
      data: { personId: person.id, endpoint: 'https://push.example/ep-unconfigured', p256dh: 'p', auth: 'a' },
    });

    // Never throws, even though nothing is actually configured to send.
    await expect(push.pushToPerson(person.id, { title: 'T', body: 'B' })).resolves.toBeUndefined();
    // And never calls out to any sending mechanism — the subscription row
    // is left untouched (not cleaned up, since no send was ever attempted).
    expect(
      await prisma.pushSubscription.findUnique({ where: { endpoint: 'https://push.example/ep-unconfigured' } }),
    ).not.toBeNull();
  });

  it('is configured once VAPID keys are set, and exposes only the public key', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey });
    expect(push.isPushConfigured()).toBe(true);
    expect(push.vapidPublicKey()).toBe(VAPID_KEYS.publicKey);
  });

  it('sends to every subscription for a Person when configured, never throwing even if one send fails', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey, PUSH_RETRY_DELAY_MS: '1' });
    const webpush = await import('web-push');
    const sendSpy = vi.spyOn(webpush.default, 'sendNotification').mockRejectedValue(new Error('network blip'));

    const community = await prisma.community.create({ data: { name: 'Push Configured Community' } });
    const person = await prisma.person.create({ data: { name: 'Push Target 2', whatsappNumber: '+237699200002' } });
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id } });
    await prisma.pushSubscription.create({
      data: { personId: person.id, endpoint: 'https://push.example/ep-configured', p256dh: 'p', auth: 'a' },
    });

    await expect(push.pushToPerson(person.id, { title: 'T', body: 'B', url: '/member/chats' })).resolves.toBeUndefined();
    // A passing failure is tried once more (and only once).
    expect(sendSpy).toHaveBeenCalledTimes(2);
    // A transient failure (not 404/410) never deletes the subscription.
    expect(
      await prisma.pushSubscription.findUnique({ where: { endpoint: 'https://push.example/ep-configured' } }),
    ).not.toBeNull();
  });

  it('removes a subscription the push service has permanently invalidated (410 Gone)', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey });
    const webpush = await import('web-push');
    vi.spyOn(webpush.default, 'sendNotification').mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    const person = await prisma.person.create({ data: { name: 'Push Target 3', whatsappNumber: '+237699200003' } });
    await prisma.pushSubscription.create({
      data: { personId: person.id, endpoint: 'https://push.example/ep-gone', p256dh: 'p', auth: 'a' },
    });

    await push.pushToPerson(person.id, { title: 'T', body: 'B' });
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint: 'https://push.example/ep-gone' } })).toBeNull();
  });

  it('pushToPersons fans out to multiple Persons\' subscriptions in one call', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey });
    const webpush = await import('web-push');
    const sendSpy = vi.spyOn(webpush.default, 'sendNotification').mockResolvedValue({} as any);

    const a = await prisma.person.create({ data: { name: 'Fan Out A', whatsappNumber: '+237699200004' } });
    const b = await prisma.person.create({ data: { name: 'Fan Out B', whatsappNumber: '+237699200005' } });
    await prisma.pushSubscription.create({ data: { personId: a.id, endpoint: 'https://push.example/ep-fanout-a', p256dh: 'p', auth: 'a' } });
    await prisma.pushSubscription.create({ data: { personId: b.id, endpoint: 'https://push.example/ep-fanout-b', p256dh: 'p', auth: 'a' } });

    await push.pushToPersons([a.id, b.id], { title: 'Broadcast', body: 'Body' });
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('pushToPersons is a no-op for an empty list', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey });
    const webpush = await import('web-push');
    const sendSpy = vi.spyOn(webpush.default, 'sendNotification').mockResolvedValue({} as any);
    await push.pushToPersons([], { title: 'T', body: 'B' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('sends at high urgency (so phones in battery-saving still get it at once), with a keep time and a time limit', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey });
    const webpush = await import('web-push');
    const sendSpy = vi.spyOn(webpush.default, 'sendNotification').mockResolvedValue({} as any);
    const a = await prisma.person.create({ data: { name: 'Urgent A', whatsappNumber: '+237699200021' } });
    await prisma.pushSubscription.create({ data: { personId: a.id, endpoint: 'https://push.example/ep-urgent', p256dh: 'p', auth: 'a' } });
    await push.pushToPerson(a.id, { title: 'T', body: 'B', urgent: true, tag: 'x' });
    const opts = sendSpy.mock.calls[0][2] as any;
    expect(opts).toMatchObject({ urgency: 'high', TTL: 3 * 24 * 60 * 60, timeout: 15000 });
    expect(JSON.parse(sendSpy.mock.calls[0][1] as string)).toMatchObject({ urgent: true, tag: 'x' });
  });

  it('a large group is sent in controlled batches, every device is reached, and failures are logged by status', async () => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey, PUSH_RETRY_DELAY_MS: '1' });
    const webpush = await import('web-push');
    let running = 0;
    let peak = 0;
    const sendSpy = vi.spyOn(webpush.default, 'sendNotification').mockImplementation((async (sub: any) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (String(sub.endpoint).endsWith('-7')) throw Object.assign(new Error('rate'), { statusCode: 429 });
      return {} as any;
    }) as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ids: string[] = [];
    for (let k = 0; k < 60; k++) {
      const p = await prisma.person.create({ data: { name: `Batch ${k}`, whatsappNumber: `+2376992${String(5000 + k)}` } });
      ids.push(p.id);
      await prisma.pushSubscription.create({ data: { personId: p.id, endpoint: `https://push.example/ep-batch-${k}`, p256dh: 'p', auth: 'a' } });
    }
    await push.pushToPersons(ids, { title: 'Big', body: 'Group' });
    expect(sendSpy).toHaveBeenCalledTimes(61); // the one that was rate-limited is tried once more
    expect(peak).toBeLessThanOrEqual(25);
    expect(warn).toHaveBeenCalledWith('[push] delivery problem', expect.objectContaining({ devices: 60, sent: 59, failed: 1, retried: 1, recovered: 0, failedByStatus: { '429': 1 } }));
  });
});

describe('Web Push: one retry for passing failures', () => {
  const setup = async (name: string) => {
    const push = await freshPushModule({ VAPID_PUBLIC_KEY: VAPID_KEYS.publicKey, VAPID_PRIVATE_KEY: VAPID_KEYS.privateKey, PUSH_RETRY_DELAY_MS: '1' });
    const webpush = await import('web-push');
    const person = await prisma.person.create({ data: { name, whatsappNumber: `+23769${String(Date.now()).slice(-8)}` } });
    await prisma.pushSubscription.create({ data: { personId: person.id, endpoint: `https://push.example/retry-${person.id}`, p256dh: 'p', auth: 'a' } });
    return { push, webpush, person };
  };

  it('a send that fails once (a timeout, a busy service) and then works is delivered, not lost', async () => {
    const { push, webpush, person } = await setup('Retry Recovers');
    const send = vi.spyOn(webpush.default, 'sendNotification').mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 503 })).mockResolvedValue({} as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await push.pushToPerson(person.id, { title: 'T', body: 'B' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[push] delivery problem', expect.objectContaining({ sent: 1, failed: 0, retried: 1, recovered: 1 }));
  });

  it('a refusal on purpose (bad request, bad credentials) is not retried, and nothing is deleted', async () => {
    const { push, webpush, person } = await setup('No Retry');
    const send = vi.spyOn(webpush.default, 'sendNotification').mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await push.pushToPerson(person.id, { title: 'T', body: 'B' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.pushSubscription.count({ where: { personId: person.id } })).toBe(1);
  });

  it('a subscription that is gone (410) is removed at once, without a retry', async () => {
    const { push, webpush, person } = await setup('Gone No Retry');
    const send = vi.spyOn(webpush.default, 'sendNotification').mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    await push.pushToPerson(person.id, { title: 'T', body: 'B' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.pushSubscription.count({ where: { personId: person.id } })).toBe(0);
  });
});
