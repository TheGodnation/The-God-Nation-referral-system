import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { centralAdminPerson, welcomeText, continueEmailText } from '../lib/trainingWelcome';

// Starting the Leadership School: a welcome from the founder's own profile (nothing about prices, payment or the
// website, because the Play Store version shows this chat too); an EMAIL with the website link to someone the admin
// approved; a Message button for the admin; and "email all approved" in batches.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.191.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
async function member(name: string, lang: 'en' | 'fr' = 'en') {
  n += 1;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2378100${String(n).padStart(5, '0')}`, preferredLanguage: lang, profileCompletedAt: new Date() } });
  const email = `tw${n}@example.com`;
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, email, agent, csrf };
}
/** The central admin's own member profile and an admin dashboard session. */
async function founder() {
  n += 1;
  const person = await prisma.person.create({ data: { name: `Evangelist Founder ${n}`, whatsappNumber: `+2378200${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  const email = `tw-admin-${n}@test.local`;
  await prisma.user.create({ data: { name: 'Founder', email, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: person.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const login = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { person, agent, csrf };
}
const chatFrom = (fromId: string, toId: string) => prisma.privateMessage.findMany({ where: { senderPersonId: fromId, conversation: { memberPersonId: toId } }, orderBy: { createdAt: 'asc' } });

afterEach(() => vi.restoreAllMocks());

describe('The welcome text', () => {
  it('has no price or payment wording, in English and in French, and one link to open the Leadership School', () => {
    for (const text of [welcomeText(false, '— A', 'https://thegodnationacademy.org/member/school'), welcomeText(true, '— A', 'https://thegodnationacademy.org/member/school?lang=fr')]) {
      expect(text).not.toMatch(/FCFA|francs|pay|paie|Mobile Money|website|site web|Orange|MTN/i);
      expect(text.match(/https?:\/\/\S+/g)).toHaveLength(1);
      expect(text).toContain('thegodnationacademy.org/member/school');
      expect(text).toContain('70');
    }
    expect(welcomeText(false, '— Evangelist Stanley A. Ndoh')).toMatch(/Welcome to the Leadership School/);
    expect(welcomeText(true, '— X')).toMatch(/Bienvenue à l’École de leadership/);
  });

  it('the email says to continue on the website, signed in with the same email', () => {
    expect(continueEmailText(false, 'Ada Obi').paragraphs.join(' ')).toMatch(/website/);
    expect(continueEmailText(false, 'Ada Obi').paragraphs[0]).toBe('Hello Ada,');
    expect(continueEmailText(true, 'Ada Obi').paragraphs.join(' ')).toMatch(/site/);
  });
});

describe('Starting the Leadership School on the website', () => {
  it('sends the founder\'s welcome once, in the person\'s language, and nothing again on a second start', async () => {
    await founder();
    const from = (await centralAdminPerson())!;
    const en = await member('Starter En');
    const fr = await member('Starter Fr', 'fr');
    expect((await en.agent.post('/api/member/training/request').set('X-CSRF-Token', en.csrf).send({})).status).toBe(201);
    expect((await fr.agent.post('/api/member/training/request').set('X-CSRF-Token', fr.csrf).send({})).status).toBe(201);
    const [hi] = await chatFrom(from.id, en.person.id);
    expect(hi.body).toContain('Welcome to the Leadership School');
    expect(hi.body.trim().endsWith(`— ${from.name}`)).toBe(true);
    expect((await chatFrom(from.id, fr.person.id))[0].body).toContain('Bienvenue à l’École de leadership');
    // Starting again changes nothing.
    await en.agent.post('/api/member/training/request').set('X-CSRF-Token', en.csrf).send({});
    expect(await chatFrom(from.id, en.person.id)).toHaveLength(1);
  });
});

describe('The Play Store version: asks, the admin approves, the website link goes by email', () => {
  it('asking sends no message; approving sends the welcome and the email (not in the app), once', async () => {
    const admin = await founder();
    const from = (await centralAdminPerson())!;
    const m = await member('Asker');
    const sent = vi.spyOn(EmailService, 'sendReminder').mockResolvedValue({ ok: true });
    expect((await m.agent.post('/api/member/training/request').set('X-CSRF-Token', m.csrf).send({ approval: true })).status).toBe(201);
    expect(await chatFrom(from.id, m.person.id)).toHaveLength(0);
    expect(sent).not.toHaveBeenCalled();

    const approved = await admin.agent.post('/api/admin/library/trainees').set('X-CSRF-Token', admin.csrf).send({ personId: m.person.id });
    expect(approved.status).toBe(200);
    expect(await chatFrom(from.id, m.person.id)).toHaveLength(1);
    expect(sent).toHaveBeenCalledTimes(1);
    const mail = sent.mock.calls[0][0];
    expect(mail.to).toBe(m.email);
    expect(mail.subject).toBe('Your Leadership School request is approved');
    expect(mail.buttonUrl).toMatch(/\/member\/school$/);
    const row = await prisma.trainingEnrollment.findUniqueOrThrow({ where: { personId: m.person.id } });
    expect(row.websiteInvitedAt).not.toBeNull();
    // Nothing inside the app (the private chat) carries a payment; the only link is to the Leadership School page itself.
    const body = (await chatFrom(from.id, m.person.id))[0].body as string;
    expect(body).not.toMatch(/pay|FCFA|Mobile Money/i);
    expect(body.match(/https?:\/\/\S+/g)).toHaveLength(1);
    expect(body).toContain('/member/school');
    // Approving again does not send a second welcome or email.
    await admin.agent.post('/api/admin/library/trainees').set('X-CSRF-Token', admin.csrf).send({ personId: m.person.id });
    expect(await chatFrom(from.id, m.person.id)).toHaveLength(1);
    expect(sent).toHaveBeenCalledTimes(1);
  });
});

describe('Message a trainee from the admin dashboard', () => {
  it('comes from the founder\'s own profile, not from Headquarters; refuses an empty message', async () => {
    const admin = await founder();
    const from = (await centralAdminPerson())!;
    const m = await member('Messaged');
    const empty = await admin.agent.post(`/api/admin/library/trainees/${m.person.id}/message`).set('X-CSRF-Token', admin.csrf).send({ body: '   ' });
    expect(empty.status).toBe(400);
    const ok = await admin.agent.post(`/api/admin/library/trainees/${m.person.id}/message`).set('X-CSRF-Token', admin.csrf).send({ body: 'Welcome, brother. How is Book 1?' });
    expect(ok.status).toBe(200);
    const [msg] = await chatFrom(from.id, m.person.id);
    expect(msg.body).toBe('Welcome, brother. How is Book 1?');
    expect(msg.senderPersonId).toBe(from.id);
    expect((await admin.agent.post('/api/admin/library/trainees/nobody/message').set('X-CSRF-Token', admin.csrf).send({ body: 'Hi' })).status).toBe(404);
  });
});

describe('Email all approved people the website link, in batches', () => {
  it('counts who is waiting, sends the next batch, and never emails anyone twice', async () => {
    const admin = await founder();
    const adminUser = await prisma.user.findFirstOrThrow({ where: { personId: admin.person.id } });
    // Three approved by the admin (waiting), one who started by themselves (never emailed), one already emailed.
    const waiting = [await member('Wait A'), await member('Wait B'), await member('Wait C')];
    for (const w of waiting) await prisma.trainingEnrollment.create({ data: { personId: w.person.id, status: 'ACTIVE', activatedAt: new Date(), activatedByUserId: adminUser.id } });
    const self = await member('Self Starter');
    await prisma.trainingEnrollment.create({ data: { personId: self.person.id, status: 'ACTIVE', activatedAt: new Date() } });
    const done = await member('Already Emailed');
    await prisma.trainingEnrollment.create({ data: { personId: done.person.id, status: 'ACTIVE', activatedAt: new Date(), activatedByUserId: adminUser.id, websiteInvitedAt: new Date() } });

    const before = (await admin.agent.get('/api/admin/library/website-invites')).body.waiting as number;
    expect(before).toBeGreaterThanOrEqual(3);
    const spy = vi.spyOn(EmailService, 'sendReminder').mockResolvedValue({ ok: true });
    const first = await admin.agent.post('/api/admin/library/website-invites/send').set('X-CSRF-Token', admin.csrf).send({ limit: 200 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ failed: 0, remaining: 0, notConfigured: false });
    expect(first.body.sent).toBe(before);
    const recipients = spy.mock.calls.map((c) => c[0].to);
    for (const w of waiting) expect(recipients).toContain(w.email);
    expect(recipients).not.toContain(self.email);
    expect(recipients).not.toContain(done.email);
    // Everyone is marked, so a second press sends nothing.
    spy.mockClear();
    const again = await admin.agent.post('/api/admin/library/website-invites/send').set('X-CSRF-Token', admin.csrf).send({});
    expect(again.body).toMatchObject({ sent: 0, remaining: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops and says so when email is not set up, leaving everyone still waiting', async () => {
    const admin = await founder();
    const adminUser = await prisma.user.findFirstOrThrow({ where: { personId: admin.person.id } });
    const m = await member('No Mail Yet');
    await prisma.trainingEnrollment.create({ data: { personId: m.person.id, status: 'ACTIVE', activatedAt: new Date(), activatedByUserId: adminUser.id } });
    vi.spyOn(EmailService, 'sendReminder').mockResolvedValue({ ok: false, skipped: true } as any);
    const res = await admin.agent.post('/api/admin/library/website-invites/send').set('X-CSRF-Token', admin.csrf).send({});
    expect(res.body.notConfigured).toBe(true);
    expect(res.body.sent).toBe(0);
    expect((await prisma.trainingEnrollment.findUniqueOrThrow({ where: { personId: m.person.id } })).websiteInvitedAt).toBeNull();
  });
});
