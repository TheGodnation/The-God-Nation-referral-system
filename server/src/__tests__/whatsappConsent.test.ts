import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { whatsappConsentOf, recordWhatsAppStop, WHATSAPP_STOP_SOURCE } from '../lib/whatsappConsent';
import { recordConsent } from '../lib/contactConsent';

// WhatsApp follow-up with consent: what each person agreed to (agreed / never ticked / asked us to stop), shown on the
// coordinator's desk and on leaders' cards, the "Opted out" (STOP) button, and the "never came back" filter.
const app = createApp();
const PASSWORD = 'GoodPass123!';
const DAY = 24 * 3600 * 1000;
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.232.${Math.floor(n / 256) % 256}.${n % 256}`;
  const w = {
    get: (p: string) => raw.get(p).set('X-Forwarded-For', ip),
    post: (p: string) => raw.post(p).set('X-Forwarded-For', ip),
  };
  return w;
}
const person = (name: string, extra: Record<string, unknown> = {}) =>
  prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378700${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), ...extra } });
async function member(name: string, opts: { createdDaysAgo?: number; seenDaysAfterJoin?: number | null; confirmed?: boolean } = {}) {
  const created = new Date(Date.now() - (opts.createdDaysAgo ?? 10) * DAY);
  const seen = opts.seenDaysAfterJoin === null || opts.seenDaysAfterJoin === undefined ? null : new Date(created.getTime() + opts.seenDaysAfterJoin * DAY);
  const p = await person(name, { createdAt: created, lastSeenAt: seen });
  await prisma.memberAccount.create({ data: { personId: p.id, email: `wc${++n}@example.com`, lastLoginAt: opts.confirmed === false ? null : created } });
  return p;
}
async function desk() {
  const adminPerson = await person('Founder');
  await prisma.memberAccount.create({ data: { personId: adminPerson.id, email: `wcf${++n}@example.com`, lastLoginAt: new Date() } });
  const user = await prisma.user.create({ data: { name: 'Founder', email: `wc-admin-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: adminPerson.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: user.email, password: PASSWORD })).status).toBe(200);
  return { agent, csrf, user, adminPerson };
}

describe('Reading a person’s WhatsApp consent', () => {
  it('is NONE until they tick, AGREED when they tick, OPTED_OUT after STOP, and ticking again later wins', async () => {
    const never = await person('Never');
    const agreed = await person('Agreed');
    const declined = await person('Declined');
    const stopped = await person('Stopped');
    const changedMind = await person('Changed');
    await recordConsent(prisma, { personId: agreed.id }, 'WHATSAPP', true, 'signup', 'en');
    await recordConsent(prisma, { personId: declined.id }, 'WHATSAPP', false, 'signup', 'en');
    await recordConsent(prisma, { personId: stopped.id }, 'WHATSAPP', true, 'signup', 'en', new Date(Date.now() - 5 * DAY));
    await recordWhatsAppStop(stopped.id);
    await recordWhatsAppStop(changedMind.id);
    await recordConsent(prisma, { personId: changedMind.id }, 'WHATSAPP', true, 'profile', 'en', new Date(Date.now() + 1000));
    const m = await whatsappConsentOf([never.id, agreed.id, declined.id, stopped.id, changedMind.id]);
    expect(m.get(never.id)).toBe('NONE');
    expect(m.get(agreed.id)).toBe('AGREED');
    expect(m.get(declined.id)).toBe('NONE');
    expect(m.get(stopped.id)).toBe('OPTED_OUT');
    expect(m.get(changedMind.id)).toBe('AGREED');
    const row = await prisma.contactConsent.findFirst({ where: { personId: stopped.id, source: WHATSAPP_STOP_SOURCE } });
    expect(row?.granted).toBe(false);
  });

  it('an email choice does not count as a WhatsApp choice', async () => {
    const p = await person('EmailOnly');
    await recordConsent(prisma, { personId: p.id }, 'EMAIL', true, 'signup', 'en');
    expect((await whatsappConsentOf([p.id])).get(p.id)).toBe('NONE');
  });
});

describe('The coordinator’s desk', () => {
  it('shows each person’s WhatsApp consent, and the Opted out button records STOP', async () => {
    const w = await desk();
    const a = await member('Agreeing');
    const b = await member('Silent');
    await recordConsent(prisma, { personId: a.id }, 'WHATSAPP', true, 'signup', 'en');
    const res = await w.agent.get('/api/admin/needs-me?filter=all&q=Agreeing');
    expect(res.body.items.find((i: any) => i.personId === a.id).whatsappConsent).toBe('AGREED');
    const res2 = await w.agent.get('/api/admin/needs-me?filter=all&q=Silent');
    expect(res2.body.items.find((i: any) => i.personId === b.id).whatsappConsent).toBe('NONE');

    expect((await w.agent.post('/api/admin/needs-me/whatsapp-stop').send({ personId: b.id })).status).toBeGreaterThanOrEqual(400);
    const stop = await w.agent.post('/api/admin/needs-me/whatsapp-stop').set('X-CSRF-Token', w.csrf).send({ personId: b.id });
    expect(stop.status).toBe(200);
    const after = await w.agent.get('/api/admin/needs-me?filter=all&q=Silent');
    expect(after.body.items.find((i: any) => i.personId === b.id).whatsappConsent).toBe('OPTED_OUT');
    expect((await w.agent.post('/api/admin/needs-me/whatsapp-stop').set('X-CSRF-Token', w.csrf).send({ personId: 'nobody' })).status).toBe(404);
  });

  it('"select all" carries the consent of each person', async () => {
    const w = await desk();
    const a = await member('SelectAgreed');
    await recordConsent(prisma, { personId: a.id }, 'WHATSAPP', true, 'signup', 'fr');
    const res = await w.agent.get('/api/admin/needs-me/ids?filter=all&q=SelectAgreed');
    expect(res.status).toBe(200);
    expect(res.body.people.find((p: any) => p.personId === a.id).whatsappConsent).toBe('AGREED');
  });

  it('the "never came back" filter finds people who joined days ago, finished setup, and were never seen after their first day', async () => {
    const w = await desk();
    const back = await member('NBBack', { createdDaysAgo: 10, seenDaysAfterJoin: 6 });
    const never = await member('NBNever', { createdDaysAgo: 10, seenDaysAfterJoin: null });
    const sameDay = await member('NBSameDay', { createdDaysAgo: 10, seenDaysAfterJoin: 0.2 });
    const tooNew = await member('NBTooNew', { createdDaysAgo: 1, seenDaysAfterJoin: null });
    const unconfirmed = await member('NBUnconfirmed', { createdDaysAgo: 10, seenDaysAfterJoin: null, confirmed: false });
    const res = await w.agent.get('/api/admin/needs-me?filter=never_back');
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(never.id);
    expect(ids).toContain(sameDay.id);
    for (const p of [back, tooNew, unconfirmed]) expect(ids).not.toContain(p.id);
    expect(res.body.counts.never_back).toBeGreaterThanOrEqual(2);
  });
});

describe('A leader’s cards', () => {
  it('carry the consent, and the leader can mark "asked to stop" only for someone they look after', async () => {
    const w = await desk();
    const community = await prisma.community.create({ data: { name: `WCHQ ${++n}`, autoPlacementEligible: false } });
    const leader = await member('Lead');
    await prisma.roleAssignment.create({ data: { personId: leader.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: w.user.id } });
    const mine = await member('Mine');
    const other = await member('NotMine');
    const a = await prisma.followUpAssignment.create({ data: { followerId: leader.id, followedPersonId: mine.id, contextType: 'COMMUNITY', contextId: community.id, assignedByUserId: w.user.id } });
    const b = await prisma.followUpAssignment.create({ data: { followerId: w.adminPerson.id, followedPersonId: other.id, contextType: 'COMMUNITY', contextId: community.id, assignedByUserId: w.user.id } });
    await recordConsent(prisma, { personId: mine.id }, 'WHATSAPP', true, 'signup', 'en');

    // The leader signs in to their dashboard (a LEADER account linked to their profile).
    const leaderUser = await prisma.user.create({ data: { name: 'L', email: `wc-leader-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'LEADER', personId: leader.id } });
    const lw = agentWithIp();
    const { csrf } = await bootstrap(lw as any);
    expect((await lw.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: leaderUser.email, password: PASSWORD })).status).toBe(200);

    const cards = await lw.get('/api/leader/my-people');
    expect(cards.status).toBe(200);
    expect(cards.body.items.find((c: any) => c.followUpAssignmentId === a.id).whatsappConsent).toBe('AGREED');

    const refused = await lw.post(`/api/leader/follow-ups/${b.id}/whatsapp-stop`).set('X-CSRF-Token', csrf).send({});
    expect(refused.status).toBe(404);
    expect((await whatsappConsentOf([other.id])).get(other.id)).toBe('NONE');
    const ok = await lw.post(`/api/leader/follow-ups/${a.id}/whatsapp-stop`).set('X-CSRF-Token', csrf).send({});
    expect(ok.status).toBe(200);
    expect((await whatsappConsentOf([mine.id])).get(mine.id)).toBe('OPTED_OUT');
    const after = await lw.get('/api/leader/my-people');
    expect(after.body.items.find((c: any) => c.followUpAssignmentId === a.id).whatsappConsent).toBe('OPTED_OUT');
  });
});
