import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { joinAsNewMember } from './joinHelper';
import { createAdmin } from './helpers';
import {
  buildMetaPayload, buildTikTokPayload, hashEmail, hashPhoneDigits, hashPhoneE164, sendAdEvent, sha256, type AdEventInput,
} from '../lib/adsEvents';
import { audienceCsv, audienceRows } from '../lib/adsAudience';
import { recordConsent } from '../lib/contactConsent';

// Phase C: server-side conversion events to Meta and TikTok, the ads consent,
// the admin "Ads connections" card, and the hashed member lists.
const app = createApp();
const DAY = 86_400_000;

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.130.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}
async function fresh() {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  return { agent, csrf };
}
let phone = 0;
const freshPhone = () => `+237674${String(100000 + ++phone).padStart(6, '0')}`;
const DETAILS = { name: 'Ada Nkeng', country: 'Cameroon', region: 'Centre', division: 'Mfoundi', subdivision: 'Yaoundé III', quarter: 'Efoulan' };

async function setSettings(data: Record<string, unknown>) {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
}

const ENV_KEYS = ['META_CAPI_TOKEN', 'TIKTOK_EVENTS_TOKEN', 'META_TEST_EVENT_CODE', 'TIKTOK_TEST_EVENT_CODE'];
beforeEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const k of ENV_KEYS) delete process.env[k]; });

function stubFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown } = () => ({})) {
  const calls: { url: string; init: RequestInit; json: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init, json: JSON.parse(String(init.body)) });
    const r = handler(String(url), init);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }));
  return calls;
}

async function person(email: string, whatsappNumber: string, extra: Record<string, unknown> = {}) {
  return prisma.person.create({ data: { name: email, whatsappNumber, email, ...extra } });
}

const base = (personId: string, o: Partial<AdEventInput> = {}): AdEventInput => ({
  personId, event: 'Lead', eventId: 'evt-12345678', email: ' Ada@Example.com ', phone: '+237 674 000 111',
  fbclid: 'IwAR0abc', ttclid: 'ttc123', fbp: 'fb.1.1700000000000.1234567890', ip: '1.2.3.4', userAgent: 'UA',
  sourceUrl: 'https://thegodnationacademy.org/member/join', at: new Date('2026-11-01T10:00:00Z'), clickedAt: new Date('2026-11-01T09:59:00Z'), ...o,
});

describe('Hashing and payloads', () => {
  it('hashes email trimmed and lower-case, and the phone the way each platform wants it', () => {
    expect(hashEmail(' Ada@Example.com ')).toBe(sha256('ada@example.com'));
    expect(hashPhoneDigits('+237 674 000 111')).toBe(sha256('237674000111'));
    expect(hashPhoneE164('237 674 000 111')).toBe(sha256('+237674000111'));
  });

  it('the Meta payload carries only hashed contact details, the click code and the shared event id', () => {
    const p = buildMetaPayload(base('p1'), 'evt-12345678', 'TEST1');
    const json = JSON.stringify(p);
    expect(json).not.toContain('ada@example.com');
    expect(json).not.toContain('674000111');
    expect(p.test_event_code).toBe('TEST1');
    const e = p.data[0];
    expect(e).toMatchObject({ event_name: 'Lead', event_id: 'evt-12345678', action_source: 'website', event_time: 1793527200 });
    expect(e.user_data).toMatchObject({
      em: [sha256('ada@example.com')], ph: [sha256('237674000111')], external_id: [sha256('p1')],
      client_ip_address: '1.2.3.4', fbp: 'fb.1.1700000000000.1234567890', fbc: `fb.1.${new Date('2026-11-01T09:59:00Z').getTime()}.IwAR0abc`,
    });
  });

  it('drops a malformed Meta cookie value instead of sending it', () => {
    const p = buildMetaPayload(base('p1', { fbp: 'not-a-cookie' }), 'evt-12345678');
    expect((p.data[0].user_data as any).fbp).toBeUndefined();
  });

  it('the TikTok payload carries only hashed contact details and the ttclid', () => {
    const p = buildTikTokPayload(base('p1', { event: 'CompleteRegistration' }), 'evt-12345678', 'PIX12345678', 'TT1');
    expect(JSON.stringify(p)).not.toContain('ada@example.com');
    expect(p).toMatchObject({ event_source: 'web', event_source_id: 'PIX12345678', test_event_code: 'TT1' });
    expect(p.data[0]).toMatchObject({ event: 'CompleteRegistration', event_id: 'evt-12345678', page: { url: 'https://thegodnationacademy.org/member/join' } });
    expect(p.data[0].user).toMatchObject({ email: sha256('ada@example.com'), phone_number: sha256('+237674000111'), ttclid: 'ttc123' });
    expect(buildTikTokPayload(base('p1'), 'e', 'P').data[0].event).toBe('SubmitForm');
  });
});

describe('Sending', () => {
  async function ready(consent: boolean | null = true) {
    await setSettings({ metaPixelId: '123456789012', tiktokPixelId: 'TTPIXEL1234' });
    process.env.META_CAPI_TOKEN = 'meta-secret';
    process.env.TIKTOK_EVENTS_TOKEN = 'tt-secret';
    const p = await person('send@example.com', freshPhone());
    if (consent !== null) await recordConsent(prisma, { personId: p.id }, 'ADS', consent, 'signup', 'en');
    return p;
  }

  it('sends to Meta and TikTok when connected and the person agreed, and logs both', async () => {
    const calls = stubFetch((url) => (url.includes('tiktok') ? { body: { code: 0 } } : { body: { events_received: 1 } }));
    const p = await ready();
    expect(await sendAdEvent(base(p.id))).toEqual(['meta', 'tiktok']);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/123456789012/events?access_token=meta-secret');
    expect(calls[1].url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/');
    expect((calls[1].init.headers as Record<string, string>)['Access-Token']).toBe('tt-secret');
    const logs = await prisma.adEventLog.findMany({ orderBy: { platform: 'asc' } });
    expect(logs.map((l) => [l.platform, l.event, l.ok, l.eventId])).toEqual([['meta', 'Lead', true, 'evt-12345678'], ['tiktok', 'Lead', true, 'evt-12345678']]);
  });

  it('sends nothing without the ads consent, or after it was taken back', async () => {
    const calls = stubFetch();
    const never = await ready(null);
    expect(await sendAdEvent(base(never.id))).toEqual([]);
    const no = await ready(true);
    await recordConsent(prisma, { personId: no.id }, 'ADS', false, 'profile', 'en');
    expect(await sendAdEvent(base(no.id))).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await prisma.adEventLog.count()).toBe(0);
  });

  it('sends nothing to a platform with no pixel id or no token', async () => {
    const calls = stubFetch();
    const p = await ready();
    delete process.env.TIKTOK_EVENTS_TOKEN;
    expect(await sendAdEvent(base(p.id))).toEqual(['meta']);
    await setSettings({ metaPixelId: null });
    expect(await sendAdEvent(base(p.id))).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('sends to a platform only when the person came from it', async () => {
    const calls = stubFetch();
    const p = await ready();
    expect(await sendAdEvent(base(p.id, { fbclid: null, fbp: null }))).toEqual(['tiktok']);
    expect(await sendAdEvent(base(p.id, { ttclid: null }))).toEqual(['meta']);
    expect(await sendAdEvent(base(p.id, { fbclid: null, fbp: null, ttclid: null }))).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('records a refusal or a network failure, and never throws', async () => {
    const p = await ready();
    stubFetch((url) => (url.includes('tiktok') ? { body: { code: 40001, message: 'bad token' } } : { status: 400, body: { error: 'bad' } }));
    await expect(sendAdEvent(base(p.id))).resolves.toEqual(['meta', 'tiktok']);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await sendAdEvent(base(p.id));
    const logs = await prisma.adEventLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => !l.ok)).toBe(true);
    expect(logs[0]).toMatchObject({ platform: 'meta', status: 400 });
    expect(logs[1]).toMatchObject({ platform: 'tiktok', status: 200 });
    expect(logs[2].error).toContain('network down');
  });

  it('makes up its own event id when the one sent is not acceptable', async () => {
    const calls = stubFetch();
    const p = await ready();
    await sendAdEvent(base(p.id, { eventId: 'bad id!' }));
    expect(calls[0].json.data[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Sign-up and profile triggers', () => {
  it('sign-up with the ads box ticked sends a Lead, then finishing the profile sends CompleteRegistration', async () => {
    const calls = stubFetch((url) => (url.includes('tiktok') ? { body: { code: 0 } } : {}));
    await setSettings({ metaPixelId: '123456789012', tiktokPixelId: 'TTPIXEL1234' });
    process.env.META_CAPI_TOKEN = 'm';
    process.env.TIKTOK_EVENTS_TOKEN = 't';
    const { agent, csrf } = await fresh();
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ utmSource: 'facebook', fbclid: 'IwAR0xyz', ttclid: 'ttc999' });
    const whatsapp = freshPhone();
    const { done } = await joinAsNewMember(agent, csrf, {
      email: 'adsyes@example.com', whatsapp, details: { ...DETAILS, adEventId: 'complete-0001' },
      extra: { consentAds: true, adEventId: 'lead-00000001', fbp: 'fb.1.1700000000000.1234567890' },
    });
    expect(done.status).toBe(200);
    await vi.waitFor(async () => expect(await prisma.adEventLog.count()).toBe(4));
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    const consent = await prisma.contactConsent.findFirstOrThrow({ where: { personId: person.id, channel: 'ADS' } });
    expect(consent).toMatchObject({ granted: true, source: 'signup' });
    expect(consent.wording).toContain('Meta');
    const logs = await prisma.adEventLog.findMany({ where: { personId: person.id } });
    expect(logs.filter((l) => l.event === 'Lead').map((l) => l.eventId)).toEqual(['lead-00000001', 'lead-00000001']);
    expect(logs.filter((l) => l.event === 'CompleteRegistration').map((l) => l.eventId)).toEqual(['complete-0001', 'complete-0001']);
    const metaLead = calls.find((c) => c.url.includes('graph.facebook.com') && c.json.data[0].event_name === 'Lead')!;
    expect(metaLead.json.data[0].user_data.fbc).toContain('IwAR0xyz');
    expect(JSON.stringify(calls.map((c) => c.json))).not.toContain('adsyes@example.com');
  });

  it('sign-up without the ads box sends nothing and records no ads consent', async () => {
    const calls = stubFetch();
    await setSettings({ metaPixelId: '123456789012' });
    process.env.META_CAPI_TOKEN = 'm';
    const { agent, csrf } = await fresh();
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ fbclid: 'IwAR0xyz' });
    const whatsapp = freshPhone();
    await joinAsNewMember(agent, csrf, { email: 'adsno@example.com', whatsapp, details: DETAILS });
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).toHaveLength(0);
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    expect(await prisma.contactConsent.count({ where: { personId: person.id, channel: 'ADS' } })).toBe(0);
  });

  it('refuses an odd event id instead of passing it on', async () => {
    const { agent, csrf } = await fresh();
    const res = await agent.post('/api/member/auth/signup').set('X-CSRF-Token', csrf).send({ email: 'odd@example.com', whatsapp: freshPhone(), password: 'Testpass123', adEventId: '<script>' });
    expect(res.status).toBe(400);
  });
});

describe('The member can change the ads choice', () => {
  it('reads and writes it with the others, keeping the history', async () => {
    const { agent, csrf } = await fresh();
    const { consume } = await joinAsNewMember(agent, csrf, { email: 'prefs@example.com', whatsapp: freshPhone(), details: DETAILS });
    expect(consume!.status).toBe(200);
    expect((await agent.get('/api/member/contact-consent')).body).toEqual({ whatsapp: null, email: null, ads: null });
    const on = await agent.put('/api/member/contact-consent').set('X-CSRF-Token', csrf).send({ ads: true });
    expect(on.body.ads).toBe(true);
    const off = await agent.put('/api/member/contact-consent').set('X-CSRF-Token', csrf).send({ ads: false });
    expect(off.body.ads).toBe(false);
    expect(await prisma.contactConsent.count({ where: { channel: 'ADS' } })).toBe(2);
  });
});

describe('Hashed member lists', () => {
  async function consented(email: string, o: { lastSeenAgoDays?: number | null; granted?: boolean; test?: boolean; deleting?: boolean } = {}) {
    const p = await person(email, freshPhone(), {
      profileCompletedAt: new Date(Date.now() - 60 * DAY),
      lastSeenAt: o.lastSeenAgoDays === undefined || o.lastSeenAgoDays === null ? null : new Date(Date.now() - o.lastSeenAgoDays * DAY),
      isTestData: o.test ?? false,
      deletionRequestedAt: o.deleting ? new Date() : null,
    });
    await recordConsent(prisma, { personId: p.id }, 'ADS', o.granted ?? true, 'signup', 'en', new Date(Date.now() - 50 * DAY));
    return p;
  }

  it('includes only people whose latest choice is yes, leaves out test and leaving accounts, and finds the quiet ones', async () => {
    const active = await consented('active@example.com', { lastSeenAgoDays: 1 });
    const quiet = await consented('quiet@example.com', { lastSeenAgoDays: 30 });
    const withdrew = await consented('withdrew@example.com', { lastSeenAgoDays: 30 });
    await recordConsent(prisma, { personId: withdrew.id }, 'ADS', false, 'profile', 'en');
    await consented('refused@example.com', { granted: false });
    await consented('test@example.com', { test: true });
    await consented('leaving@example.com', { deleting: true });
    await person('never-asked@example.com', freshPhone());

    const all = await audienceRows('members', 7);
    expect(all.map((r) => r.personId).sort()).toEqual([active.id, quiet.id].sort());
    expect((await audienceRows('quiet', 7)).map((r) => r.personId)).toEqual([quiet.id]);
  });

  it('writes hashes only, one row per person', async () => {
    const csv = audienceCsv([{ personId: 'x', email: 'Ada@Example.com', phone: '+237674000111' }, { personId: 'y', email: null, phone: '+237674000222' }]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('email_sha256,phone_sha256_digits_only,phone_sha256_with_plus');
    expect(lines[1]).toBe([sha256('ada@example.com'), sha256('237674000111'), sha256('+237674000111')].join(','));
    expect(lines[2].startsWith(',')).toBe(true);
    expect(csv).not.toContain('@');
    expect(csv).not.toContain('674000111');
  });
});

describe('Admin ads card', () => {
  async function admin() {
    await createAdmin('ads-admin@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'ads-admin@test.local', password: 'AdminPass123!' });
    return { agent, csrf };
  }

  it('is for the admin only', async () => {
    expect((await request(app).get('/api/admin/ads')).status).toBe(401);
    expect((await request(app).get('/api/admin/ads/audience.csv')).status).toBe(401);
  });

  it('saves the public ids, rejects odd ones, clears with an empty value, and shows status without any token', async () => {
    const { agent, csrf } = await admin();
    process.env.META_CAPI_TOKEN = 'super-secret-token';
    const first = await agent.get('/api/admin/ads');
    expect(first.body.ids.metaPixelId).toBeNull();
    expect(first.body.meta).toEqual({ tokenSet: true, testMode: false, serverReady: false });
    expect(first.body.tiktok.tokenSet).toBe(false);
    expect(JSON.stringify(first.body)).not.toContain('super-secret-token');

    const put = await agent.put('/api/admin/ads').set('X-CSRF-Token', csrf).send({
      metaPixelId: '123456789012345', tiktokPixelId: 'CABCDEF123456', googleTagId: 'AW-123456789', googleLeadSendTo: 'AW-123456789/AbC-dEfGhIj', googleSignupSendTo: '',
    });
    expect(put.status).toBe(200);
    expect(put.body.ids).toMatchObject({ metaPixelId: '123456789012345', tiktokPixelId: 'CABCDEF123456', googleTagId: 'AW-123456789', googleLeadSendTo: 'AW-123456789/AbC-dEfGhIj', googleSignupSendTo: null });
    expect(put.body.meta.serverReady).toBe(true);

    for (const bad of [{ metaPixelId: 'abc' }, { tiktokPixelId: '<x>' }, { googleTagId: 'UA-1' }, { googleLeadSendTo: 'AW-123456789' }]) {
      expect((await agent.put('/api/admin/ads').set('X-CSRF-Token', csrf).send(bad)).status).toBe(400);
    }
    const cleared = await agent.put('/api/admin/ads').set('X-CSRF-Token', csrf).send({ metaPixelId: '' });
    expect(cleared.body.ids.metaPixelId).toBeNull();
    expect(cleared.body.ids.tiktokPixelId).toBe('CABCDEF123456');
    expect(await prisma.auditLog.count({ where: { action: 'ADS_IDS_UPDATED' } })).toBe(2);
  });

  it('publishes the ids (and no token) in the public settings', async () => {
    process.env.META_CAPI_TOKEN = 'super-secret-token';
    await setSettings({ metaPixelId: '123456789012', googleTagId: 'AW-123456789' });
    const res = await request(app).get('/api/settings/public');
    expect(res.body.ads).toEqual({ metaPixelId: '123456789012', tiktokPixelId: null, googleTagId: 'AW-123456789', googleLeadSendTo: null, googleSignupSendTo: null });
    expect(JSON.stringify(res.body)).not.toContain('super-secret-token');
  });

  it('shows recent events and the list sizes, and downloads the hashed list (audited)', async () => {
    const { agent, csrf } = await admin();
    const p = await person('listed@example.com', freshPhone(), { profileCompletedAt: new Date(Date.now() - 60 * DAY) });
    await recordConsent(prisma, { personId: p.id }, 'ADS', true, 'signup', 'en');
    await prisma.adEventLog.create({ data: { personId: p.id, platform: 'meta', event: 'Lead', eventId: 'e1', ok: false, status: 400, error: 'bad token' } });
    await prisma.adEventLog.create({ data: { personId: p.id, platform: 'tiktok', event: 'Lead', eventId: 'e1', ok: true, status: 200 } });
    const sum = await agent.get('/api/admin/ads');
    expect(sum.body.last7).toEqual({ ok: 1, failed: 1 });
    expect(sum.body.recent).toHaveLength(2);
    expect(sum.body.audiences).toMatchObject({ members: 1, quiet: 1, quietDays: 7 });
    expect(JSON.stringify(sum.body)).not.toContain('listed@example.com');

    const csv = await agent.get('/api/admin/ads/audience.csv?kind=members');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('god-nation-members-hashed.csv');
    expect(csv.text).toContain(hashEmail('listed@example.com'));
    expect(csv.text).not.toContain('listed@example.com');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ADS_AUDIENCE_EXPORTED' } });
    expect(audit.metadata).toMatchObject({ kind: 'members', people: 1 });
    void csrf;
  });
});
