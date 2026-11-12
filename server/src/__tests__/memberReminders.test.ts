import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

// Pretend the email service is set up, so the reminders really run (nothing is
// sent: the send itself is replaced in each test).
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), emailConfigured: true }));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { processMemberReminders, reminderPending } from '../lib/memberReminders';
import { makeUnsubscribeToken, readUnsubscribeToken } from '../lib/unsubscribe';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let n = 0;

async function setSettings(data: Record<string, unknown>) {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
}

async function member(opts: {
  createdAgoMs: number; confirmed?: boolean; profileDone?: boolean; lastSeenAgoMs?: number | null; lang?: 'en' | 'fr';
  emailConsent?: boolean; test?: boolean; deleting?: boolean; name?: string;
}) {
  n += 1;
  const created = new Date(Date.now() - opts.createdAgoMs);
  const email = `remind${n}@example.com`;
  const person = await prisma.person.create({
    data: {
      name: opts.name ?? email, whatsappNumber: `+23767520${String(1000 + n)}`, email, preferredLanguage: opts.lang ?? 'en',
      isTestData: opts.test ?? false, deletionRequestedAt: opts.deleting ? new Date() : null,
      profileCompletedAt: opts.profileDone ? created : null,
      lastSeenAt: opts.lastSeenAgoMs === undefined || opts.lastSeenAgoMs === null ? null : new Date(Date.now() - opts.lastSeenAgoMs),
    },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: 'x', createdAt: created, lastLoginAt: opts.confirmed ? created : null } });
  if (opts.emailConsent !== undefined) await prisma.contactConsent.create({ data: { personId: person.id, channel: 'EMAIL', granted: opts.emailConsent, wording: 'Yes', source: 'profile' } });
  return { person, email };
}

function spySend(result: { ok: boolean; skipped?: boolean } = { ok: true }) {
  return vi.spyOn(EmailService, 'sendReminder').mockResolvedValue(result);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The reminder emails now obey the daytime rule (08:00-19:00 in Cameroon), so for them the clock is
// held at 10:00 Cameroon time (09:00 UTC) today; only Date is faked, so timers and the database work normally.
function holdDaytime() {
  const t = new Date();
  t.setUTCHours(9, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(t);
}

describe('Reminder emails', () => {
  beforeEach(holdDaytime);

  it('send nothing while they are switched off (the default)', async () => {
    await member({ createdAgoMs: 5 * HOUR });
    const spy = spySend();
    expect(await processMemberReminders()).toMatchObject({ sent: {}, reason: 'off' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('"finish your sign-up": once, after two hours, to someone who never signed in', async () => {
    await setSettings({ remindersEnabled: true });
    const { person, email } = await member({ createdAgoMs: 5 * HOUR });
    await member({ createdAgoMs: 30 * 60_000 }); // too soon
    const spy = spySend();
    const r = await processMemberReminders();
    expect(r.sent).toEqual({ FINISH_SIGNUP_1: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ to: email, subject: 'Finish joining The God Nation', buttonLabel: 'Finish joining' });
    expect(spy.mock.calls[0][0].unsubscribeUrl).toBeUndefined();
    expect(await prisma.memberReminder.count({ where: { personId: person.id, kind: 'FINISH_SIGNUP_1' } })).toBe(1);
    // Never twice.
    spy.mockClear();
    expect((await processMemberReminders()).sent).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('a second nudge after three days, and one for someone signed in who has not given their name and place', async () => {
    await setSettings({ remindersEnabled: true });
    await member({ createdAgoMs: 4 * DAY });
    await member({ createdAgoMs: 2 * DAY, confirmed: true });
    const spy = spySend();
    const r = await processMemberReminders();
    expect(r.sent).toEqual({ FINISH_SIGNUP_2: 1, FINISH_PROFILE: 1 });
    const subjects = spy.mock.calls.map((c) => c[0].subject).sort();
    expect(subjects).toEqual(['One last step: your name and place', 'Your place at The God Nation is waiting']);
  });

  it('use the person’s language', async () => {
    await setSettings({ remindersEnabled: true });
    await member({ createdAgoMs: 5 * HOUR, lang: 'fr' });
    const spy = spySend();
    await processMemberReminders();
    expect(spy.mock.calls[0][0].subject).toBe('Terminez votre inscription à The God Nation');
  });

  it('leave out test data, people who asked to delete their account, and people who finished joining', async () => {
    await setSettings({ remindersEnabled: true });
    await member({ createdAgoMs: 5 * HOUR, test: true });
    await member({ createdAgoMs: 5 * HOUR, deleting: true });
    await member({ createdAgoMs: 5 * HOUR, confirmed: true, profileDone: true });
    const spy = spySend();
    expect((await processMemberReminders()).sent).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('"we miss you": only to quiet members who agreed to emails, with a one-click unsubscribe', async () => {
    await setSettings({ remindersEnabled: true, reminderQuietDays: 7 });
    const yes = await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, lastSeenAgoMs: 10 * DAY, emailConsent: true, name: 'Ada Nkeng' });
    await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, lastSeenAgoMs: 10 * DAY }); // never asked
    await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, lastSeenAgoMs: 10 * DAY, emailConsent: false }); // said no
    await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, lastSeenAgoMs: 2 * DAY, emailConsent: true }); // not quiet
    const spy = spySend();
    expect((await processMemberReminders()).sent).toEqual({ WINBACK: 1 });
    const call = spy.mock.calls[0][0];
    expect(call).toMatchObject({ to: yes.email, subject: 'We miss you at The God Nation' });
    expect(call.paragraphs[0]).toBe('Hi Ada Nkeng,');
    expect(readUnsubscribeToken(new URL(call.unsubscribeUrl!).searchParams.get('t')!)).toBe(yes.person.id);
  });

  it('"we miss you" goes once per quiet spell, and again after they come back and go quiet again', async () => {
    await setSettings({ remindersEnabled: true, reminderQuietDays: 7 });
    const a = await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, lastSeenAgoMs: 10 * DAY, emailConsent: true });
    const spy = spySend();
    await processMemberReminders();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await processMemberReminders(new Date(Date.now() + 5 * DAY));
    expect(spy).not.toHaveBeenCalled();
    // They came back for a day, then went quiet again.
    await prisma.person.update({ where: { id: a.person.id }, data: { lastSeenAt: new Date(Date.now() + 1 * DAY) } });
    await processMemberReminders(new Date(Date.now() + 20 * DAY));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never send more than the daily limit', async () => {
    await setSettings({ remindersEnabled: true, reminderDailyCap: 2 });
    for (let i = 0; i < 4; i++) await member({ createdAgoMs: 5 * HOUR });
    const spy = spySend();
    expect((await processMemberReminders()).sent).toEqual({ FINISH_SIGNUP_1: 2 });
    spy.mockClear();
    expect((await processMemberReminders()).sent).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('give the claim back when a send fails, so it is tried again later', async () => {
    await setSettings({ remindersEnabled: true });
    await member({ createdAgoMs: 5 * HOUR });
    spySend({ ok: false });
    expect((await processMemberReminders()).sent).toEqual({});
    expect(await prisma.memberReminder.count()).toBe(0);
  });

  it('obey the shared safety rules: no night sends, nothing soon after being seen, one nudge in three days across every kind', async () => {
    await setSettings({ remindersEnabled: true });
    const { person: quiet } = await member({ createdAgoMs: 5 * HOUR });
    const spy = spySend();
    // At night in Cameroon (21:00 UTC is 22:00 there): nothing, whoever is waiting.
    vi.setSystemTime(new Date(Date.now() + 12 * HOUR));
    expect(await processMemberReminders()).toMatchObject({ sent: {}, reason: 'night' });
    vi.setSystemTime(new Date(Date.now() - 12 * HOUR));
    // A phone nudge yesterday counts: no email within three days of it.
    await prisma.memberReminder.create({ data: { personId: quiet.id, kind: 'NUDGE_DAY3', sentAt: new Date(Date.now() - DAY) } });
    expect((await processMemberReminders()).sent).toEqual({});
    // Seen in the app a few hours ago: not yet either (and the old nudge is out of the way).
    await prisma.memberReminder.deleteMany({ where: { personId: quiet.id } });
    await prisma.person.update({ where: { id: quiet.id }, data: { lastSeenAt: new Date(Date.now() - 5 * HOUR) } });
    expect((await processMemberReminders()).sent).toEqual({});
    expect(spy).not.toHaveBeenCalled();
    // Once the rules allow, it goes.
    await prisma.person.update({ where: { id: quiet.id }, data: { lastSeenAt: new Date(Date.now() - 3 * DAY) } });
    expect((await processMemberReminders()).sent).toEqual({ FINISH_SIGNUP_1: 1 });
  });

  it('count who would get one now, so the admin can see before switching on', async () => {
    await member({ createdAgoMs: 5 * HOUR });
    await member({ createdAgoMs: 4 * DAY });
    expect(await reminderPending()).toMatchObject({ FINISH_SIGNUP_1: 1, FINISH_SIGNUP_2: 1, FINISH_PROFILE: 0, WINBACK: 0 });
  });
});

describe('Unsubscribe link', () => {
  it('stops the emails and says so, in the right language, and shows in their choices', async () => {
    const m = await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, emailConsent: true, lang: 'fr' });
    const token = makeUnsubscribeToken(m.person.id);
    const res = await request(app).get(`/api/unsubscribe?t=${token}&lang=fr`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Vous ne recevrez plus de nouvelles par e-mail');
    const latest = await prisma.contactConsent.findFirstOrThrow({ where: { personId: m.person.id, channel: 'EMAIL' }, orderBy: { createdAt: 'desc' } });
    expect(latest).toMatchObject({ granted: false, source: 'unsubscribe-link' });
    // Again: no second record.
    await request(app).get(`/api/unsubscribe?t=${token}`);
    expect(await prisma.contactConsent.count({ where: { personId: m.person.id, channel: 'EMAIL', granted: false } })).toBe(1);
  });

  it('works as the one-click form mail apps use', async () => {
    const m = await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, emailConsent: true });
    const res = await request(app).post(`/api/unsubscribe?t=${makeUnsubscribeToken(m.person.id)}`);
    expect(res.status).toBe(200);
    expect((await prisma.contactConsent.findFirstOrThrow({ where: { personId: m.person.id }, orderBy: { createdAt: 'desc' } })).granted).toBe(false);
  });

  it('refuses a link that was changed or made up, and changes nothing', async () => {
    const a = await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, emailConsent: true });
    const b = await member({ createdAgoMs: 60 * DAY, confirmed: true, profileDone: true, emailConsent: true });
    const forged = `${makeUnsubscribeToken(a.person.id).split('.')[0]}.${makeUnsubscribeToken(b.person.id).split('.')[1]}`;
    expect((await request(app).get(`/api/unsubscribe?t=${forged}`)).status).toBe(400);
    expect((await request(app).get('/api/unsubscribe?t=garbage')).status).toBe(400);
    expect((await request(app).get('/api/unsubscribe')).status).toBe(400);
    expect(await prisma.contactConsent.count({ where: { granted: false } })).toBe(0);
  });
});

describe('Admin reminder settings', () => {
  async function admin() {
    await createAdmin('reminders-admin@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'reminders-admin@test.local', password: 'AdminPass123!' });
    return { agent, csrf };
  }

  it('is for the admin only', async () => {
    expect((await request(app).get('/api/admin/reminders')).status).toBe(401);
  });

  it('starts switched off with sensible numbers, and the admin can change them', async () => {
    const { agent, csrf } = await admin();
    await member({ createdAgoMs: 4 * DAY });
    const first = await agent.get('/api/admin/reminders');
    expect(first.body).toMatchObject({ enabled: false, quietDays: 7, dailyCap: 40, sentToday: 0 });
    expect(first.body.pending.FINISH_SIGNUP_2).toBe(1);
    const put = await agent.put('/api/admin/reminders').set('X-CSRF-Token', csrf).send({ enabled: true, quietDays: 14, dailyCap: 25 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ enabled: true, quietDays: 14, dailyCap: 25 });
    expect((await agent.put('/api/admin/reminders').set('X-CSRF-Token', csrf).send({ enabled: true, quietDays: 0, dailyCap: 25 })).status).toBe(400);
    // The phone and in-app nudges have their own switch: off by default, and not changed by a save that leaves it out.
    expect(first.body.nudges).toMatchObject({ enabled: false, sentToday: 0 });
    expect(Object.keys(first.body.nudges.pending).sort()).toEqual(['NUDGE_DAY3', 'NUDGE_DAY7']);
    const on = await agent.put('/api/admin/reminders').set('X-CSRF-Token', csrf).send({ enabled: true, quietDays: 14, dailyCap: 25, nudgesEnabled: true });
    expect(on.body.nudges.enabled).toBe(true);
    const keep = await agent.put('/api/admin/reminders').set('X-CSRF-Token', csrf).send({ enabled: false, quietDays: 14, dailyCap: 25 });
    expect(keep.body).toMatchObject({ enabled: false });
    expect(keep.body.nudges.enabled).toBe(true);
    expect((await agent.put('/api/admin/reminders').set('X-CSRF-Token', csrf).send({ enabled: true, quietDays: 7, dailyCap: 9999 })).status).toBe(400);
  });
});
