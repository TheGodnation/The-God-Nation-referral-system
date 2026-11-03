import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { joinAsNewMember } from './joinHelper';
import { createAdmin } from './helpers';
import { referrerHostOf } from '../routes/referrals';

// Phase A of the growth foundation: ad click codes on visits, recorded consent,
// the "stay connected" box (leads), the member's own contact choices, and the
// "Join our WhatsApp group" click.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.120.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
const freshPhone = () => `+237673${String(100000 + ++phone).padStart(6, '0')}`;

const DETAILS = { name: 'Ada Nkeng', country: 'Cameroon', region: 'Centre', division: 'Mfoundi', subdivision: 'Yaoundé III', quarter: 'Efoulan' };

afterEach(() => vi.restoreAllMocks());

describe('Ad click codes on visits', () => {
  it('keeps utm_content, the click codes and the website the visitor came from', async () => {
    const { agent, csrf } = await fresh();
    const res = await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({
      utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'launch', utmContent: 'video-1',
      fbclid: 'IwAR0abc_DEF-123', ttclid: 'E.C.P.xyz', gclid: 'Cj0KCQ.test',
      referrer: 'https://l.facebook.com/l.php?u=abc', landingPage: '/?utm_source=facebook',
    });
    expect(res.status).toBe(201);
    const v = await prisma.referralVisit.findUniqueOrThrow({ where: { id: res.body.visitId } });
    expect(v).toMatchObject({ utmContent: 'video-1', fbclid: 'IwAR0abc_DEF-123', ttclid: 'E.C.P.xyz', gclid: 'Cj0KCQ.test', referrerHost: 'l.facebook.com' });
  });

  it('drops a click code with odd characters, and never keeps more than the website name', async () => {
    const { agent, csrf } = await fresh();
    const res = await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ fbclid: '<script>alert(1)</script>', referrer: 'not a url' });
    expect(res.status).toBe(201);
    const v = await prisma.referralVisit.findUniqueOrThrow({ where: { id: res.body.visitId } });
    expect(v.fbclid).toBeNull();
    expect(v.referrerHost).toBeNull();
  });

  it('referrerHostOf ignores our own site and bad input', () => {
    expect(referrerHostOf('https://www.tiktok.com/@x/video/1', 'thegodnationacademy.org')).toBe('tiktok.com');
    expect(referrerHostOf('https://thegodnationacademy.org/join', 'thegodnationacademy.org')).toBeNull();
    expect(referrerHostOf(undefined, 'x')).toBeNull();
    expect(referrerHostOf('::::', 'x')).toBeNull();
  });
});

describe('Sign-up consent and ad details', () => {
  it('records the ticked choices with the sentence shown, and copies the ad details to the registration', async () => {
    const { agent, csrf } = await fresh();
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ utmSource: 'tiktok', utmCampaign: 'nov', ttclid: 'abc123', referrer: 'https://www.tiktok.com/' });
    const whatsapp = freshPhone();
    const { done } = await joinAsNewMember(agent, csrf, { email: 'consent1@example.com', whatsapp, language: 'fr', details: DETAILS, extra: { consentWhatsapp: true, consentEmail: false } });
    expect(done.status).toBe(200);

    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    const rows = await prisma.contactConsent.findMany({ where: { personId: person.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'WHATSAPP', granted: true, source: 'signup' });
    expect(rows[0].wording).toContain('WhatsApp');
    expect(rows[0].wording).toMatch(/^Oui/);

    const reg = await prisma.registration.findFirstOrThrow({ where: { personId: person.id } });
    expect(reg).toMatchObject({ utmSource: 'tiktok', utmCampaign: 'nov', ttclid: 'abc123', referrerHost: 'tiktok.com' });
  });

  it('records nothing when nothing is ticked', async () => {
    const { agent, csrf } = await fresh();
    const whatsapp = freshPhone();
    await joinAsNewMember(agent, csrf, { email: 'consent2@example.com', whatsapp, details: DETAILS });
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    expect(await prisma.contactConsent.count({ where: { personId: person.id } })).toBe(0);
  });
});

describe('The "stay connected" box (leads)', () => {
  it('needs the agreement ticked, and a valid number', async () => {
    const { agent, csrf } = await fresh();
    const noTick = await agent.post('/api/leads').set('X-CSRF-Token', csrf).send({ name: 'Paul', whatsapp: freshPhone(), consentWhatsapp: false });
    expect(noTick.status).toBe(400);
    expect(noTick.body.code).toBe('CONSENT_REQUIRED');
    const badPhone = await agent.post('/api/leads').set('X-CSRF-Token', csrf).send({ name: 'Paul', whatsapp: '12', consentWhatsapp: true });
    expect(badPhone.status).toBe(400);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('keeps the lead with where they came from, and the proof of agreement', async () => {
    const { agent, csrf } = await fresh();
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ utmSource: 'google', gclid: 'g123', landingPage: '/' });
    const whatsapp = freshPhone();
    const res = await agent.post('/api/leads').set('X-CSRF-Token', csrf).send({ name: 'Paul', whatsapp, language: 'en', consentWhatsapp: true });
    expect(res.status).toBe(200);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { whatsappNumber: whatsapp }, include: { consents: true } });
    expect(lead).toMatchObject({ name: 'Paul', utmSource: 'google', gclid: 'g123' });
    expect(lead.consents).toHaveLength(1);
    expect(lead.consents[0]).toMatchObject({ channel: 'WHATSAPP', granted: true, source: 'stay-connected' });
  });

  it('gives the same reply for a repeat or an existing member, without making duplicates', async () => {
    const { agent, csrf } = await fresh();
    const whatsapp = freshPhone();
    const body = { name: 'Paul', whatsapp, consentWhatsapp: true };
    expect((await agent.post('/api/leads').set('X-CSRF-Token', csrf).send(body)).body).toEqual({ ok: true });
    expect((await agent.post('/api/leads').set('X-CSRF-Token', csrf).send(body)).body).toEqual({ ok: true });
    expect(await prisma.lead.count({ where: { whatsappNumber: whatsapp } })).toBe(1);

    const member = await prisma.person.create({ data: { name: 'Member', whatsappNumber: freshPhone() } });
    const res = await agent.post('/api/leads').set('X-CSRF-Token', csrf).send({ name: 'Member', whatsapp: member.whatsappNumber, consentWhatsapp: true });
    expect(res.body).toEqual({ ok: true });
    expect(await prisma.lead.count({ where: { whatsappNumber: member.whatsappNumber } })).toBe(0);
  });

  it('becomes the member when the same number signs up, and the agreement moves with it', async () => {
    const { agent, csrf } = await fresh();
    const whatsapp = freshPhone();
    await agent.post('/api/leads').set('X-CSRF-Token', csrf).send({ name: 'Paul', whatsapp, consentWhatsapp: true });
    await joinAsNewMember(agent, csrf, { email: 'lead2member@example.com', whatsapp, details: DETAILS });
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    expect(lead.convertedPersonId).toBe(person.id);
    const rows = await prisma.contactConsent.findMany({ where: { personId: person.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'WHATSAPP', granted: true, source: 'stay-connected' });
  });
});

describe('A member’s own contact choices and the group click', () => {
  async function signedInMember() {
    const { agent, csrf } = await fresh();
    const whatsapp = freshPhone();
    await joinAsNewMember(agent, csrf, { email: `prefs${phone}@example.com`, whatsapp, details: DETAILS });
    const person = await prisma.person.findUniqueOrThrow({ where: { whatsappNumber: whatsapp } });
    return { agent, csrf, person };
  }

  it('needs sign-in', async () => {
    const { agent } = await fresh();
    expect((await agent.get('/api/member/contact-consent')).status).toBe(401);
  });

  it('shows "not answered", then follows each change and keeps the history', async () => {
    const { agent, csrf, person } = await signedInMember();
    expect((await agent.get('/api/member/contact-consent')).body).toEqual({ whatsapp: null, email: null, ads: null });

    const on = await agent.put('/api/member/contact-consent').set('X-CSRF-Token', csrf).send({ whatsapp: true, email: true });
    expect(on.body).toEqual({ whatsapp: true, email: true, ads: null });
    const off = await agent.put('/api/member/contact-consent').set('X-CSRF-Token', csrf).send({ whatsapp: false });
    expect(off.body).toEqual({ whatsapp: false, email: true, ads: null });
    // Same answer again adds nothing.
    await agent.put('/api/member/contact-consent').set('X-CSRF-Token', csrf).send({ whatsapp: false });
    const rows = await prisma.contactConsent.findMany({ where: { personId: person.id, channel: 'WHATSAPP' } });
    expect(rows.map((r) => r.granted).sort()).toEqual([false, true]);
  });

  it('notes a tap on "Join our WhatsApp group" against their registration', async () => {
    const { agent, csrf, person } = await signedInMember();
    expect((await agent.post('/api/member/group-link-click').set('X-CSRF-Token', csrf).send({})).status).toBe(200);
    const reg = await prisma.registration.findFirstOrThrow({ where: { personId: person.id } });
    expect(await prisma.event.count({ where: { type: 'GROUP_LINK_CLICKED', registrationId: reg.id } })).toBe(1);
  });
});

describe('Choosing where to join', () => {
  it('counts a member’s tap on a place, with which place it was', async () => {
    const { agent, csrf } = await fresh();
    const whatsapp = freshPhone();
    await joinAsNewMember(agent, csrf, { email: `place${phone}@example.com`, whatsapp, details: DETAILS });
    expect((await agent.post('/api/member/group-link-click').set('X-CSRF-Token', csrf).send({ platform: 'telegram_channel' })).status).toBe(200);
    const ev = await prisma.event.findFirstOrThrow({ where: { type: 'GROUP_LINK_CLICKED' } });
    expect(ev.detail).toBe('telegram_channel');
    expect((await agent.post('/api/member/group-link-click').set('X-CSRF-Token', csrf).send({ platform: 'myspace' })).status).toBe(400);
  });

  it('counts a tap from someone who only left a number, without an account', async () => {
    const { agent, csrf } = await fresh();
    expect((await agent.post('/api/leads/click').set('X-CSRF-Token', csrf).send({ platform: 'messenger' })).status).toBe(200);
    const ev = await prisma.event.findFirstOrThrow({ where: { type: 'GROUP_LINK_CLICKED' } });
    expect(ev).toMatchObject({ detail: 'messenger', registrationId: null });
    expect(ev.visitorId).toBeTruthy();
    expect((await agent.post('/api/leads/click').set('X-CSRF-Token', csrf).send({ platform: 'nope' })).status).toBe(400);
    expect((await agent.post('/api/leads/click').set('X-CSRF-Token', csrf).send({})).status).toBe(400);
  });

  it('the admin sets the extra places in Settings and the public settings show them', async () => {
    await createAdmin('places-admin@test.local', 'AdminPass123!');
    const admin = request.agent(app);
    const { csrf } = await bootstrap(admin);
    await admin.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'places-admin@test.local', password: 'AdminPass123!' });
    const saved = await admin.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({
      whatsappChannelUrl: 'https://whatsapp.com/channel/ABC',
      telegramGroupUrl: 'https://t.me/godnation_group',
      telegramUrl: 'https://t.me/godnation',
      messengerUrl: 'https://m.me/j/XYZ',
      facebookGroupUrl: 'https://facebook.com/groups/godnation',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ whatsappChannelUrl: 'https://whatsapp.com/channel/ABC', telegramGroupUrl: 'https://t.me/godnation_group', facebookGroupUrl: 'https://facebook.com/groups/godnation' });
    const pub = await request(app).get('/api/settings/public');
    expect(pub.body).toMatchObject({ whatsappChannelUrl: 'https://whatsapp.com/channel/ABC', telegramGroupUrl: 'https://t.me/godnation_group', telegramUrl: 'https://t.me/godnation', messengerUrl: 'https://m.me/j/XYZ', facebookGroupUrl: 'https://facebook.com/groups/godnation' });
    // Clearing one leaves the others.
    const cleared = await admin.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ telegramGroupUrl: null });
    expect(cleared.body.telegramGroupUrl).toBeNull();
    expect(cleared.body.whatsappChannelUrl).toBe('https://whatsapp.com/channel/ABC');
    expect((await admin.patch('/api/admin/settings').set('X-CSRF-Token', csrf).send({ facebookGroupUrl: 'join us' })).status).toBe(400);
  });
});
