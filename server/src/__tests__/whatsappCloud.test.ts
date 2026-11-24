import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { cloudConfigured, sendTemplate, toCloudNumber, whatsappCloudNotify } from '../lib/whatsappCloud';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Automatic WhatsApp messages through Meta's WhatsApp Business Platform: off by default, only with the person's own agreement,
// only the central admin in test mode, and never a crash when Meta says no.
const app = createApp();
let n = 0;
let calls: { url: string; body: any; auth: string | null }[] = [];

function metaAnswers(res: { status?: number; body: unknown } = { body: { messages: [{ id: 'wamid.ABC' }] } }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
      const status = res.status ?? 200;
      return { ok: status < 300, status, json: async () => res.body } as Response;
    }),
  );
}
const setMode = (mode: 'OFF' | 'TEST' | 'ON') => prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', whatsappCloudMode: mode }, update: { whatsappCloudMode: mode } });

async function person(opts: { consent?: boolean | null; lang?: 'en' | 'fr'; name?: string } = {}) {
  n += 1;
  const p = await prisma.person.create({ data: { name: opts.name ?? `Teacher ${n}`, whatsappNumber: `+237679${String(n).padStart(6, '0')}`, preferredLanguage: opts.lang ?? 'en' } });
  if (opts.consent !== undefined && opts.consent !== null) await prisma.contactConsent.create({ data: { personId: p.id, channel: 'WHATSAPP', granted: opts.consent, wording: 'Yes', source: 'profile' } });
  return p;
}

beforeEach(async () => {
  calls = [];
  process.env.WHATSAPP_ACCESS_TOKEN = 'secret-token-123';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '555000111';
  await setMode('OFF');
  await prisma.whatsAppCloudSend.deleteMany();
});
afterEach(() => {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sending a template message to Meta', () => {
  it('posts the template with the person’s language and the blanks filled, using the secret token only in the header', async () => {
    metaAnswers();
    const r = await sendTemplate({ to: '+237 679 000 123', template: 'teaching_assignment', language: 'fr', params: ['Ada', 'Le Pardon', 'lundi 10:00'] });
    expect(r).toEqual({ ok: true, messageId: 'wamid.ABC' });
    expect(calls[0].url).toContain('/555000111/messages');
    expect(calls[0].auth).toBe('Bearer secret-token-123');
    expect(JSON.stringify(calls[0].body)).not.toContain('secret-token');
    expect(calls[0].body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '237679000123',
      type: 'template',
      template: { name: 'teaching_assignment', language: { code: 'fr' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ada' }, { type: 'text', text: 'Le Pardon' }, { type: 'text', text: 'lundi 10:00' }] }] },
    });
    expect(toCloudNumber('+237 679-000-123')).toBe('237679000123');
  });

  it('says why when Meta refuses, and does nothing when it is not set up', async () => {
    metaAnswers({ status: 400, body: { error: { code: 131030, message: 'Recipient not in allowed list' } } });
    expect(await sendTemplate({ to: '+237679000123', template: 'x', language: 'en' })).toEqual({ ok: false, error: '131030: Recipient not in allowed list' });
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    expect(cloudConfigured()).toBe(false);
    calls = [];
    expect((await sendTemplate({ to: '+237679000123', template: 'x', language: 'en' })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('Automatic WhatsApp messages to members', () => {
  const vars = { topic: 'The Right to Forgiveness', when: 'Monday 10:00' };

  it('send nothing while the switch is off', async () => {
    metaAnswers();
    const p = await person({ consent: true });
    expect(await whatsappCloudNotify(p.id, 'teaching_assignment', vars)).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect(await prisma.whatsAppCloudSend.count()).toBe(0);
  });

  it('go to a person who agreed, in their own language, and are recorded', async () => {
    metaAnswers();
    await setMode('ON');
    const p = await person({ consent: true, lang: 'fr', name: 'Ada Ngwa' });
    expect(await whatsappCloudNotify(p.id, 'teaching_tomorrow', vars)).toBe('sent');
    expect(calls[0].body.template.language.code).toBe('fr');
    expect(calls[0].body.template.components[0].parameters[0].text).toBe('Ada');
    const row = await prisma.whatsAppCloudSend.findFirstOrThrow({ where: { personId: p.id } });
    expect(row).toMatchObject({ status: 'SENT', kind: 'teaching_tomorrow', template: 'teaching_tomorrow', language: 'fr', messageId: 'wamid.ABC' });
  });

  it('are held back for someone who never agreed or said no, with the reason recorded', async () => {
    metaAnswers();
    await setMode('ON');
    const never = await person({ consent: null });
    const no = await person({ consent: false });
    expect(await whatsappCloudNotify(never.id, 'teaching_hour', vars)).toBe('skipped');
    expect(await whatsappCloudNotify(no.id, 'teaching_hour', vars)).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect((await prisma.whatsAppCloudSend.findMany({ where: { status: 'SKIPPED' } })).every((r) => /agree/.test(r.reason ?? ''))).toBe(true);
  });

  it('in test mode go only to the central admin’s own number', async () => {
    metaAnswers();
    await setMode('TEST');
    const teacher = await person({ consent: true });
    const boss = await person({ consent: true, name: 'Central Admin' });
    await prisma.user.create({ data: { name: 'Central Admin', email: `boss-wa-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: boss.id } });
    expect(await whatsappCloudNotify(teacher.id, 'teaching_assignment', vars)).toBe('skipped');
    expect(await whatsappCloudNotify(boss.id, 'teaching_assignment', vars)).toBe('sent');
    expect(calls).toHaveLength(1);
  });

  it('never crash when Meta says no: the failure is recorded', async () => {
    metaAnswers({ status: 500, body: { error: { code: 1, message: 'Unknown' } } });
    await setMode('ON');
    const p = await person({ consent: true });
    expect(await whatsappCloudNotify(p.id, 'teaching_hour', { topic: 'T' })).toBe('failed');
    expect(await prisma.whatsAppCloudSend.findFirstOrThrow({ where: { personId: p.id } })).toMatchObject({ status: 'FAILED' });
  });

  it('are held back, and say so, when Meta’s sending is not set up yet', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    await setMode('ON');
    const p = await person({ consent: true });
    expect(await whatsappCloudNotify(p.id, 'teaching_hour', { topic: 'T' })).toBe('skipped');
    expect((await prisma.whatsAppCloudSend.findFirstOrThrow({ where: { personId: p.id } })).reason).toMatch(/not set up/);
  });
});

describe('The central admin’s WhatsApp switch', () => {
  async function admin(email: string) {
    await createAdmin(email, 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
    return { agent, csrf };
  }

  it('is for the admin only, and starts off', async () => {
    expect((await request(app).get('/api/admin/whatsapp-cloud')).status).toBe(401);
    const { agent } = await admin('wa-admin-1@test.local');
    const first = await agent.get('/api/admin/whatsapp-cloud');
    expect(first.body).toMatchObject({ mode: 'OFF', configured: true, today: { sent: 0, failed: 0, skipped: 0 } });
    expect(JSON.stringify(first.body)).not.toContain('secret-token');
  });

  it('can be switched to Test and On only once Meta’s sending is set up', async () => {
    const { agent, csrf } = await admin('wa-admin-2@test.local');
    const on = await agent.put('/api/admin/whatsapp-cloud').set('X-CSRF-Token', csrf).send({ mode: 'TEST' });
    expect(on.body.mode).toBe('TEST');
    expect((await agent.put('/api/admin/whatsapp-cloud').set('X-CSRF-Token', csrf).send({ mode: 'MAYBE' })).status).toBe(400);
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const refused = await agent.put('/api/admin/whatsapp-cloud').set('X-CSRF-Token', csrf).send({ mode: 'ON' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('NOT_CONFIGURED');
    // Switching off is always allowed.
    expect((await agent.put('/api/admin/whatsapp-cloud').set('X-CSRF-Token', csrf).send({ mode: 'OFF' })).body.mode).toBe('OFF');
  });

  it('sends Meta’s sample message to a number and shows it in the list, with the number partly hidden', async () => {
    metaAnswers();
    const { agent, csrf } = await admin('wa-admin-3@test.local');
    const res = await agent.post('/api/admin/whatsapp-cloud/test').set('X-CSRF-Token', csrf).send({ to: '+237 677 111 222' });
    expect(res.status).toBe(200);
    expect(calls[0].body).toMatchObject({ to: '237677111222', template: { name: 'hello_world', language: { code: 'en_US' } } });
    expect(res.body.recent[0]).toMatchObject({ kind: 'test', status: 'SENT', to: '+237…222' });
    expect(res.body.today.sent).toBe(1);
  });

  it('reports a refused test message plainly', async () => {
    metaAnswers({ status: 400, body: { error: { code: 131030, message: 'Recipient not in allowed list' } } });
    const { agent, csrf } = await admin('wa-admin-4@test.local');
    const res = await agent.post('/api/admin/whatsapp-cloud/test').set('X-CSRF-Token', csrf).send({ to: '+237677111222' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/131030/);
    expect((await agent.post('/api/admin/whatsapp-cloud/test').set('X-CSRF-Token', csrf).send({ to: '12' })).status).toBe(400);
  });
});
