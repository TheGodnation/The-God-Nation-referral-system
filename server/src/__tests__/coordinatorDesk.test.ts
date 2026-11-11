import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// "People who need me": the National Coordinator's desk (list + filters, take over, mark contacted, message many)
// and the WhatsApp number on the people who joined through the coordinator's link.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;
const DAY = 24 * 3600 * 1000;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.231.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
const person = (name: string, extra: Record<string, unknown> = {}) =>
  prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2378600${String(n).padStart(5, '0')}`, ...extra } });

/** A signed-up member (has a member account); `confirmed` = has signed in at least once. */
async function signedUp(name: string, opts: { confirmed?: boolean; complete?: boolean; seenDaysAgo?: number } = {}) {
  const p = await person(name, {
    profileCompletedAt: opts.complete === false ? null : new Date(),
    lastSeenAt: new Date(Date.now() - (opts.seenDaysAgo ?? 0) * DAY),
  });
  await prisma.memberAccount.create({ data: { personId: p.id, email: `nm${++n}@example.com`, lastLoginAt: opts.confirmed === false ? null : new Date() } });
  return p;
}

async function memberAgent(personId: string) {
  const account = await prisma.memberAccount.findUniqueOrThrow({ where: { personId } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email: account.email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  expect((await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email: account.email, code })).status).toBe(200);
  return { agent, csrf };
}

async function world() {
  const adminPerson = await person('Founder');
  await prisma.memberAccount.create({ data: { personId: adminPerson.id, email: `founder${++n}@example.com`, lastLoginAt: new Date() } });
  const adminUser = await prisma.user.create({ data: { name: 'Founder', email: `nm-admin-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', personId: adminPerson.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  expect((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: adminUser.email, password: PASSWORD })).status).toBe(200);
  const community = await prisma.community.create({ data: { name: `NMHQ ${++n}`, autoPlacementEligible: false } });
  const leader = await signedUp('Leader');
  await prisma.roleAssignment.create({ data: { personId: leader.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: adminUser.id } });
  const unconfirmed = await signedUp('Unconfirmed', { confirmed: false, complete: false });
  const neglected = await signedUp('Neglected'); // active, but its leader has not contacted them for 10 days
  const cared = await signedUp('Cared'); // active, its leader wrote yesterday
  const lonely = await signedUp('Lonely'); // active, no leader at all
  for (const p of [leader, unconfirmed, neglected, cared, lonely]) await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id } });
  const follow = (followed: string, assignedDaysAgo: number) =>
    prisma.followUpAssignment.create({ data: { followerId: leader.id, followedPersonId: followed, contextType: 'COMMUNITY', contextId: community.id, assignedByUserId: adminUser.id, assignedAt: new Date(Date.now() - assignedDaysAgo * DAY) } });
  const nAssign = await follow(neglected.id, 10);
  const cAssign = await follow(cared.id, 10);
  await prisma.followUpContact.create({ data: { followUpAssignmentId: cAssign.id, wellbeingStatus: 'GOOD', loggedByUserId: adminUser.id, contactedAt: new Date(Date.now() - DAY) } });
  return { adminPerson, adminUser, agent, csrf, community, leader, unconfirmed, neglected, cared, lonely, nAssign };
}
const list = async (w: Awaited<ReturnType<typeof world>>, qs = '') => (await w.agent.get(`/api/admin/needs-me${qs}`)).body;
const names = (body: any) => body.items.map((i: any) => i.name);

describe('People who need me — the list', () => {
  it('puts the people nobody is looking after first, leaves out healthy ones and the central admin, and counts each kind', async () => {
    const w = await world();
    const body = await list(w, `?communityId=${w.community.id}`);
    const got = names(body);
    // (The leader is here too: nobody follows a leader up yet, and following leaders up is the coordinator's job.)
    expect(got).toEqual(expect.arrayContaining([w.unconfirmed.name, w.neglected.name, w.lonely.name, w.leader.name]));
    expect(got).not.toContain(w.cared.name);
    expect(got).not.toContain(w.adminPerson.name);
    expect(body.counts).toMatchObject({ all: 5, needs: 4, not_confirmed: 1, profile_incomplete: 0, no_leader: 3, leader_silent: 1, mine: 0 });
    // The leader shown for each, and the WhatsApp number (the desk is the coordinator's).
    const neglected = body.items.find((i: any) => i.personId === w.neglected.id);
    expect(neglected).toMatchObject({ status: 'ACTIVE', leaderSilent: true, noLeader: false, leader: { personId: w.leader.id }, whatsapp: expect.stringMatching(/^\+237/) });
    expect(body.items.find((i: any) => i.personId === w.lonely.id)).toMatchObject({ noLeader: true, leader: null });
  });

  it('filters by kind, by name and by language', async () => {
    const w = await world();
    const c = `communityId=${w.community.id}`;
    expect(names(await list(w, `?${c}&filter=leader_silent`))).toEqual([w.neglected.name]);
    expect(names(await list(w, `?${c}&filter=not_confirmed`))).toEqual([w.unconfirmed.name]);
    expect(names(await list(w, `?${c}&filter=all&q=Cared`))).toEqual([w.cared.name]);
    await prisma.person.update({ where: { id: w.lonely.id }, data: { preferredLanguage: 'fr' } });
    expect(names(await list(w, `?${c}&filter=all&language=fr`))).toEqual([w.lonely.name]);
  });

  it('a private message from the leader counts as contact', async () => {
    const w = await world();
    const conv = await prisma.privateConversation.create({ data: { memberPersonId: w.neglected.id, initiatorPersonId: w.leader.id } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: w.leader.id, body: 'How are you?' } });
    expect(names(await list(w, `?communityId=${w.community.id}&filter=leader_silent`))).toEqual([]);
  });

  it('"select all" gives every person matching the filter', async () => {
    const w = await world();
    const res = await w.agent.get(`/api/admin/needs-me/ids?communityId=${w.community.id}&filter=needs`);
    expect(res.body.total).toBe(4);
    expect(res.body.ids.sort()).toEqual([w.unconfirmed.id, w.neglected.id, w.lonely.id, w.leader.id].sort());
  });

  it('is for the central admin only', async () => {
    const agent = agentWithIp();
    await bootstrap(agent as any);
    expect([401, 403]).toContain((await agent.get('/api/admin/needs-me')).status);
    const ordinary = await signedUp('Ordinary');
    const m = await memberAgent(ordinary.id);
    expect((await m.agent.get('/api/member/central-needs-me')).status).toBe(403);
  });
});

describe('People who need me — take over and mark contacted', () => {
  it('takes a person over from their leader, once, deleting nobody', async () => {
    const w = await world();
    const res = await w.agent.post('/api/admin/needs-me/take-over').set('X-CSRF-Token', w.csrf).send({ personId: w.neglected.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ changed: true });
    const rows = await prisma.followUpAssignment.findMany({ where: { followedPersonId: w.neglected.id } });
    expect(rows.find((a) => a.id === w.nAssign.id)).toMatchObject({ status: 'CLOSED', closeReason: 'Taken over by the central admin', closedByUserId: w.adminUser.id });
    expect(rows.find((a) => a.followerId === w.adminPerson.id)).toMatchObject({ status: 'ACTIVE', contextId: w.community.id });
    expect((await w.agent.post('/api/admin/needs-me/take-over').set('X-CSRF-Token', w.csrf).send({ personId: w.neglected.id })).body).toEqual({ changed: false });
    const body = await list(w, `?communityId=${w.community.id}&filter=mine`);
    expect(names(body)).toEqual([w.neglected.name]);
    expect(body.items[0]).toMatchObject({ mine: true, leader: null, noLeader: false });
    // Nobody told this person "your leader" (the coordinator is not a leader assignment).
    expect(await prisma.followUpAssignment.count({ where: { followerId: w.adminPerson.id, introducedAt: { not: null } } })).toBe(0);
  });

  it('can take over someone who has no leader, using their assembly', async () => {
    const w = await world();
    expect((await w.agent.post('/api/admin/needs-me/take-over').set('X-CSRF-Token', w.csrf).send({ personId: w.lonely.id })).body).toEqual({ changed: true });
    expect(await prisma.followUpAssignment.count({ where: { followerId: w.adminPerson.id, followedPersonId: w.lonely.id, contextId: w.community.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('records a contact only on people taken over, and it then counts as contact', async () => {
    const w = await world();
    const before = await w.agent.post('/api/admin/needs-me/contacted').set('X-CSRF-Token', w.csrf).send({ personId: w.lonely.id });
    expect(before.status).toBe(409);
    await w.agent.post('/api/admin/needs-me/take-over').set('X-CSRF-Token', w.csrf).send({ personId: w.lonely.id });
    const ok = await w.agent.post('/api/admin/needs-me/contacted').set('X-CSRF-Token', w.csrf).send({ personId: w.lonely.id, wellbeing: 'NEEDS_ATTENTION', note: 'Needs prayer' });
    expect(ok.status).toBe(201);
    expect(await prisma.followUpContact.findFirst({ where: { followUpAssignment: { followedPersonId: w.lonely.id } } })).toMatchObject({ wellbeingStatus: 'NEEDS_ATTENTION', note: 'Needs prayer', loggedByUserId: w.adminUser.id });
    const mine = (await list(w, `?communityId=${w.community.id}&filter=mine`)).items[0];
    expect(mine.lastContactAt).not.toBeNull();
  });

  it('refuses someone who does not exist or has asked to be deleted', async () => {
    const w = await world();
    expect((await w.agent.post('/api/admin/needs-me/take-over').set('X-CSRF-Token', w.csrf).send({ personId: 'nobody' })).status).toBe(404);
    await prisma.person.update({ where: { id: w.lonely.id }, data: { deletionRequestedAt: new Date() } });
    expect((await w.agent.post('/api/admin/needs-me/take-over').set('X-CSRF-Token', w.csrf).send({ personId: w.lonely.id })).status).toBe(404);
  });
});

describe('People who need me — message many as National Coordinator', () => {
  it('sends one private message to each person chosen, from the coordinator, who shows as National Coordinator', async () => {
    const w = await world();
    const res = await w.agent.post('/api/admin/needs-me/message').set('X-CSRF-Token', w.csrf).send({ personIds: [w.unconfirmed.id, w.neglected.id, w.adminPerson.id], body: 'God bless you. How can we help?' });
    expect(res.status).toBe(201);
    // The coordinator's own profile is never a recipient.
    expect(res.body).toMatchObject({ recipients: 2, skipped: 0 });
    for (const p of [w.unconfirmed, w.neglected]) {
      const msg = await prisma.privateMessage.findFirstOrThrow({ where: { conversation: { memberPersonId: p.id } } });
      expect(msg.senderPersonId).toBe(w.adminPerson.id);
      expect(msg.body).toContain('Hello, greetings from The God Nation');
      expect(msg.body).toContain('God bless you. How can we help?');
      const note = await prisma.notification.findFirstOrThrow({ where: { recipientPersonId: p.id, type: 'PRIVATE_MESSAGE_RECEIVED' } });
      expect((note.metadata as any).senderBadge).toBe('NATIONAL_COORDINATOR');
    }
    // The person sees the National Coordinator label in their private chats.
    const m = await memberAgent(w.neglected.id);
    const chats = await m.agent.get('/api/private-messages/conversations');
    expect(chats.body.items[0]).toMatchObject({ otherPartyName: w.adminPerson.name, otherPartyBadge: 'NATIONAL_COORDINATOR' });
    // And it is recorded in the broadcast log, with the audit trail.
    expect(await prisma.leaderBroadcast.count({ where: { senderPersonId: w.adminPerson.id, recipientCount: 2 } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LEADER_BROADCAST_SENT', actorId: w.adminUser.id } })).toBe(1);
  });

  it('needs somebody to send to, and something to say', async () => {
    const w = await world();
    expect((await w.agent.post('/api/admin/needs-me/message').set('X-CSRF-Token', w.csrf).send({ personIds: [], body: 'Hi' })).status).toBe(400);
    expect((await w.agent.post('/api/admin/needs-me/message').set('X-CSRF-Token', w.csrf).send({ personIds: [w.lonely.id] })).status).toBe(400);
    expect((await w.agent.post('/api/admin/needs-me/message').set('X-CSRF-Token', w.csrf).send({ personIds: [w.adminPerson.id], body: 'Hi' })).status).toBe(400);
  });
});

describe('The WhatsApp number on people who joined through the link', () => {
  it('the central admin sees it, as a leader does', async () => {
    const w = await world();
    const joined = await signedUp('Joined');
    await prisma.registration.create({ data: { visitorId: `v${++n}`, normalizedWhatsApp: joined.whatsappNumber!, name: joined.name, personId: joined.id, referredByPersonId: w.adminPerson.id } });
    const m = await memberAgent(w.adminPerson.id);
    const res = await m.agent.get('/api/member/referrals/mine');
    expect(res.status).toBe(200);
    expect(res.body.canSeeWhatsapp).toBe(true);
    expect(res.body.items[0]).toMatchObject({ personId: joined.id, whatsapp: joined.whatsappNumber });
    // An ordinary member still does not.
    const other = await signedUp('Ordinary Ambassador');
    const reg = await signedUp('Their Friend');
    await prisma.registration.create({ data: { visitorId: `v${++n}`, normalizedWhatsApp: reg.whatsappNumber!, name: reg.name, personId: reg.id, referredByPersonId: other.id } });
    const o = await memberAgent(other.id);
    const res2 = await o.agent.get('/api/member/referrals/mine');
    expect(res2.body.canSeeWhatsapp).toBe(false);
    expect(res2.body.items[0].whatsapp).toBeUndefined();
  });
});
