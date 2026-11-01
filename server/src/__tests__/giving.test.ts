import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { processGivingPost, givingPostText } from '../lib/givingPost';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Giving: gifts go to the central administration (the member says "I have
// given", the central admin confirms); leaders never see who gave; totals per
// assembly are for the central admin; offerings, tithes and free-will gifts
// are never listed; a campaign has a public report with names and amounts,
// and "Anonymous" on request; a weekly invitation is posted in the groups.
const app = createApp();

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.155.0.${ip}`);
  return wrapped;
}
let n = 0;
async function member(name: string, communityId?: string) {
  n += 1;
  const email = `give${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2376650${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  if (communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE' } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}
async function adminLogin() {
  await createAdmin('give-admin@test.local', 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'give-admin@test.local', password: 'AdminPass123!' });
  return { agent, csrf };
}
const give = (m: Awaited<ReturnType<typeof member>>, body: Record<string, unknown>) =>
  m.agent.post('/api/member/giving/gifts').set('X-CSRF-Token', m.csrf).send({ kind: 'OFFERING', amount: 5000, reference: 'MP123456', ...body });

describe('a member says "I have given"', () => {
  it('records a waiting gift in the giver\'s assembly, and refuses a bad amount or a missing transaction ID', async () => {
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const m = await member('Giver Grace', a.id);
    const ok = await give(m, { kind: 'TITHE', amount: 20000 });
    expect(ok.status).toBe(201);
    const row = await prisma.gift.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(row).toMatchObject({ personId: m.person.id, communityId: a.id, kind: 'TITHE', amount: 20000, status: 'CLAIMED', anonymous: false });

    expect((await give(m, { amount: 50 })).status).toBe(400);
    expect((await give(m, { amount: 5000.5 })).status).toBe(400);
    expect((await give(m, { reference: 'x' })).status).toBe(400);
    expect((await give(m, { kind: 'CAMPAIGN' })).status).toBe(400); // a campaign must be named
    // "Anonymous" only means something for a campaign.
    const off = await give(m, { anonymous: true });
    expect((await prisma.gift.findUniqueOrThrow({ where: { id: off.body.id } })).anonymous).toBe(false);
  });

  it('shows the giver how to give and only their own gifts', async () => {
    await createAdmin('give-admin@test.local', 'AdminPass123!');
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', givingInstructionsEn: 'Send to 6xx xx xx xx', givingInstructionsFr: 'Envoyez au 6xx xx xx xx' }, update: { givingInstructionsEn: 'Send to 6xx xx xx xx', givingInstructionsFr: 'Envoyez au 6xx xx xx xx' } });
    const a = await member('Giver A');
    const b = await member('Giver B');
    await give(a, { amount: 1000 });
    await give(b, { amount: 7000 });
    const info = await a.agent.get('/api/member/giving/info');
    expect(info.status).toBe(200);
    expect(info.body.instructions).toBe('Send to 6xx xx xx xx');
    expect(info.body.mine.map((g: any) => g.amount)).toEqual([1000]);
  });
});

describe('the central admin confirms gifts and sees the totals', () => {
  it('confirming thanks the giver and counts in the totals per kind and per assembly; rejecting does not; a gift is decided once', async () => {
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const b = await prisma.community.create({ data: { name: 'Assembly B' } });
    const ma = await member('Giver A', a.id);
    const mb = await member('Giver B', b.id);
    const g1 = (await give(ma, { amount: 5000 })).body.id;
    const g2 = (await give(ma, { kind: 'TITHE', amount: 10000 })).body.id;
    const g3 = (await give(mb, { amount: 3000 })).body.id;
    const { agent, csrf } = await adminLogin();

    const waiting = await agent.get('/api/admin/giving/waiting');
    expect(waiting.body.items).toHaveLength(3);
    expect(waiting.body.items[0]).toMatchObject({ giverName: 'Giver A', assemblyName: 'Assembly A', amount: 5000, reference: 'MP123456' });

    for (const [id, decision] of [[g1, 'CONFIRM'], [g2, 'CONFIRM'], [g3, 'REJECT']] as const) {
      expect((await agent.post(`/api/admin/giving/gifts/${id}/decide`).set('X-CSRF-Token', csrf).send({ decision })).status).toBe(200);
    }
    expect((await agent.post(`/api/admin/giving/gifts/${g1}/decide`).set('X-CSRF-Token', csrf).send({ decision: 'REJECT' })).status).toBe(409);

    const summary = (await agent.get('/api/admin/giving/summary')).body;
    expect(summary).toMatchObject({ confirmedTotal: 15000, confirmedCount: 2, waitingCount: 0 });
    expect(summary.byKind.find((k: any) => k.kind === 'TITHE')).toMatchObject({ total: 10000, count: 1 });
    expect(summary.byAssembly).toEqual([{ communityId: a.id, name: 'Assembly A', total: 15000, count: 2 }]);

    expect(await prisma.notification.count({ where: { recipientPersonId: ma.person.id, type: 'GIFT_CONFIRMED' } })).toBe(2);
    expect(await prisma.notification.count({ where: { recipientPersonId: mb.person.id, type: 'GIFT_REJECTED' } })).toBe(1);
  });
});

describe('help-one-another campaigns', () => {
  it('has a public report with names and amounts, "Anonymous" on request, and never lists offerings, tithes or unconfirmed gifts', async () => {
    const { agent, csrf } = await adminLogin();
    const created = await agent.post('/api/admin/giving/campaigns').set('X-CSRF-Token', csrf).send({ titleEn: 'Help Brother Paul', titleFr: 'Aidons le frère Paul', targetAmount: 100000 });
    expect(created.status).toBe(201);
    const campaignId = created.body.id;

    const open = await member('Open Olivia');
    const shy = await member('Shy Samuel');
    const quiet = await member('Offering Oscar');
    const waitingOne = await member('Waiting Wendy');
    const c1 = (await give(open, { kind: 'CAMPAIGN', campaignId, amount: 20000 })).body.id;
    const c2 = (await give(shy, { kind: 'CAMPAIGN', campaignId, amount: 30000, anonymous: true })).body.id;
    const o1 = (await give(quiet, { kind: 'OFFERING', amount: 9999 })).body.id;
    await give(waitingOne, { kind: 'CAMPAIGN', campaignId, amount: 1000 });
    for (const id of [c1, c2, o1]) await agent.post(`/api/admin/giving/gifts/${id}/decide`).set('X-CSRF-Token', csrf).send({ decision: 'CONFIRM' });

    // Any member can read the report.
    const reader = await member('Just a reader');
    const report = await reader.agent.get(`/api/member/giving/campaigns/${campaignId}/report`);
    expect(report.status).toBe(200);
    expect(report.body.campaign).toMatchObject({ raised: 50000, giftCount: 2, targetAmount: 100000 });
    expect(report.body.gifts.map((g: any) => [g.name, g.amount])).toEqual([['Open Olivia', 20000], [null, 30000]]);
    expect(JSON.stringify(report.body)).not.toContain('Shy Samuel');
    expect(JSON.stringify(report.body)).not.toContain('Offering Oscar');
    expect(JSON.stringify(report.body)).not.toContain('Waiting Wendy');

    // The member list shows the open campaign with what it has raised.
    const info = await reader.agent.get('/api/member/giving/info');
    expect(info.body.campaigns).toEqual([expect.objectContaining({ id: campaignId, raised: 50000 })]);
  });

  it('a closed campaign takes no more gifts', async () => {
    const { agent, csrf } = await adminLogin();
    const campaignId = (await agent.post('/api/admin/giving/campaigns').set('X-CSRF-Token', csrf).send({ titleEn: 'Old campaign' })).body.id;
    expect((await agent.patch(`/api/admin/giving/campaigns/${campaignId}/close`).set('X-CSRF-Token', csrf).send({})).status).toBe(200);
    const m = await member('Late Larry');
    expect((await give(m, { kind: 'CAMPAIGN', campaignId })).status).toBe(400);
  });
});

describe('leaders never see who gave', () => {
  it('no giving endpoint is open to a leader or an ordinary member; the central admin\'s member profile has the same tools', async () => {
    const a = await prisma.community.create({ data: { name: 'Assembly A' } });
    const { user } = await createLeader('Lead Er', 'leader-give@test.local', 'LGIVE001');
    const leaderPerson = await prisma.person.create({ data: { name: 'Lead Er', whatsappNumber: '+237699500001' } });
    await prisma.user.update({ where: { id: user.id }, data: { personId: leaderPerson.id } });
    await prisma.roleAssignment.create({ data: { personId: leaderPerson.id, roleType: 'SCOPED_LEADER', communityId: a.id, assignedByUserId: user.id } });
    const giver = await member('Giver Grace', a.id);
    await give(giver, { amount: 5000 });

    const leader = agentWithUniqueIp();
    const { csrf } = await bootstrap(leader as any);
    await leader.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-give@test.local', password: 'password123' });
    for (const path of ['/api/admin/giving/summary', '/api/admin/giving/waiting', '/api/admin/giving/campaigns']) {
      expect((await leader.get(path)).status).toBeGreaterThanOrEqual(401);
      expect((await leader.get(path)).status).toBeLessThan(404);
    }
    // An ordinary member cannot use the central admin's member-profile endpoints either.
    expect((await giver.agent.get('/api/member/central-giving/summary')).status).toBe(403);
    // The leader's own follow-up card carries no gifts.
    const cards = await leader.get('/api/leader/my-people');
    expect(JSON.stringify(cards.body)).not.toMatch(/gift|giving|offering|tithe/i);

  });

  it('the central admin\'s own member profile has the same giving tools', async () => {
    const giver = await member('Giver Grace');
    const gift = (await give(giver, { amount: 4000 })).body.id;
    const owner = await member('Owner Person');
    const admin = await createAdmin('give-owner@test.local', 'AdminPass123!');
    await prisma.user.update({ where: { id: admin.id }, data: { personId: owner.person.id } });

    const waiting = await owner.agent.get('/api/member/central-giving/waiting');
    expect(waiting.status).toBe(200);
    expect(waiting.body.items[0]).toMatchObject({ giverName: 'Giver Grace', amount: 4000 });
    const decided = await owner.agent.post(`/api/member/central-giving/gifts/${gift}/decide`).set('X-CSRF-Token', owner.csrf).send({ decision: 'CONFIRM' });
    expect(decided.status).toBe(200);
    expect((await owner.agent.get('/api/member/central-giving/summary')).body.confirmedTotal).toBe(4000);
    const saved = await owner.agent.put('/api/member/central-giving/instructions').set('X-CSRF-Token', owner.csrf).send({ en: 'Pay to 6xx', fr: 'Payer au 6xx', weeklyPost: true });
    expect(saved.status).toBe(200);
    expect((await giver.agent.get('/api/member/giving/info')).body.instructions).toBe('Pay to 6xx');
  });
});

describe('the weekly invitation to give', () => {
  it('is posted once a week in every assembly, names nobody and shows no amount, and needs instructions and the switch on', async () => {
    const admin = await createAdmin('give-admin@test.local', 'AdminPass123!');
    const adminPerson = await prisma.person.create({ data: { name: 'Evangelist', whatsappNumber: '+237699500003' } });
    await prisma.user.update({ where: { id: admin.id }, data: { personId: adminPerson.id } });
    const a = await prisma.community.create({ data: { name: 'A' } });
    const b = await prisma.community.create({ data: { name: 'B' } });
    await prisma.conversation.create({ data: { communityId: a.id } });
    await prisma.conversation.create({ data: { communityId: b.id } });
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} });

    expect(await processGivingPost()).toBe(0); // no instructions yet
    await prisma.settings.update({ where: { id: 'singleton' }, data: { givingInstructionsEn: 'Mobile Money 6xx', givingInstructionsFr: 'Mobile Money 6xx' } });
    expect(await processGivingPost()).toBe(2);
    const messages = await prisma.message.findMany();
    expect(messages).toHaveLength(2);
    expect(messages[0].senderPersonId).toBe(adminPerson.id);
    expect(messages[0].body).toContain('free-will');
    expect(messages[0].body).toContain('Donner cette semaine');
    expect(messages[0].body).not.toMatch(/\d+\s*FCFA/);

    expect(await processGivingPost()).toBe(0); // not again this week
    await prisma.settings.update({ where: { id: 'singleton' }, data: { lastGivingPostAt: new Date(Date.now() - 8 * 24 * 3600 * 1000), givingWeeklyPost: false } });
    expect(await processGivingPost()).toBe(0); // switched off
  });

  it('writes both languages and falls back to the other language\'s instructions', () => {
    expect(givingPostText('Pay here', null)).toMatch(/Pay here[\s\S]*Pay here/);
  });
});
