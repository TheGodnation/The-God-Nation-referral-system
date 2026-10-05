import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import bcrypt from 'bcryptjs';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Friends, blocking, reports, people search, and the Option B messaging
// rule: members may message friends, people in their own group and their
// leaders — strangers must become friends first.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.116.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;
interface Member {
  agent: Agent;
  csrf: string;
  id: string;
}

let n = 0;
async function member(name: string, location: Record<string, string> = {}): Promise<Member> {
  n += 1;
  const whatsapp = `+2376704${String(n).padStart(5, '0')}`;
  const email = `social${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp, ...location } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}

async function group(name: string, ...people: Member[]) {
  const c = await prisma.community.create({ data: { name } });
  for (const p of people) await prisma.communityMembership.create({ data: { personId: p.id, communityId: c.id } });
  return c;
}

async function assigner() {
  return (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? createAdmin(`assigner${n}@test.local`, 'AdminPass123!');
}

async function makeLeaderOf(p: Member, communityId: string) {
  const admin = await assigner();
  await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: admin.id } });
}

const send = (m: Member, path: string, body: Record<string, unknown> = {}) => m.agent.post(path).set('X-CSRF-Token', m.csrf).send(body);

async function befriend(a: Member, b: Member) {
  const r = await send(a, '/api/member/friends/requests', { personId: b.id });
  await send(b, `/api/member/friends/requests/${r.body.requestId}/accept`);
}

describe('Friend requests', () => {
  it('sends, notifies, accepts, and lists friends on both sides', async () => {
    const a = await member('Ada');
    const b = await member('Ben');
    const req = await send(a, '/api/member/friends/requests', { personId: b.id });
    expect(req.status).toBe(201);
    expect(req.body.friendStatus).toBe('REQUEST_SENT');

    const note = await prisma.notification.findFirst({ where: { recipientPersonId: b.id, type: 'FRIEND_REQUEST_RECEIVED' } });
    expect(note).toBeTruthy();

    const incoming = await b.agent.get('/api/member/friends/requests');
    expect(incoming.body.incoming.map((p: any) => p.name)).toEqual(['Ada']);

    await send(b, `/api/member/friends/requests/${req.body.requestId}/accept`);
    expect((await a.agent.get('/api/member/friends')).body.items.map((p: any) => p.name)).toEqual(['Ben']);
    expect((await b.agent.get('/api/member/friends')).body.items.map((p: any) => p.name)).toEqual(['Ada']);
    expect(await prisma.notification.count({ where: { recipientPersonId: a.id, type: 'FRIEND_REQUEST_ACCEPTED' } })).toBe(1);
  });

  it('accepts automatically when both ask each other', async () => {
    const a = await member('Ann');
    const b = await member('Bob');
    await send(a, '/api/member/friends/requests', { personId: b.id });
    const back = await send(b, '/api/member/friends/requests', { personId: a.id });
    expect(back.body.friendStatus).toBe('FRIENDS');
  });

  it('declining removes the request quietly; only the addressee can accept', async () => {
    const a = await member('Asker');
    const b = await member('Decliner');
    const req = await send(a, '/api/member/friends/requests', { personId: b.id });
    expect((await send(a, `/api/member/friends/requests/${req.body.requestId}/accept`)).status).toBe(404);
    await send(b, `/api/member/friends/requests/${req.body.requestId}/decline`);
    expect(await prisma.friendship.count()).toBe(0);
  });

  it('respects the "only my group" setting', async () => {
    const a = await member('Outsider');
    const b = await member('Private Person');
    const c = await member('Groupmate');
    await group('Shared', b, c);
    await b.agent.patch('/api/member/me/social-settings').set('X-CSRF-Token', b.csrf).send({ friendRequestPolicy: 'SAME_GROUP' });

    const refused = await send(a, '/api/member/friends/requests', { personId: b.id });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('SAME_GROUP_ONLY');
    expect((await send(c, '/api/member/friends/requests', { personId: b.id })).status).toBe(201);
  });

  it('unfriending removes the friendship', async () => {
    const a = await member('Friend One');
    const b = await member('Friend Two');
    await befriend(a, b);
    await a.agent.delete(`/api/member/friends/${b.id}`).set('X-CSRF-Token', a.csrf);
    expect((await b.agent.get('/api/member/friends')).body.items).toEqual([]);
  });
});

describe('Messaging rule (Option B)', () => {
  it('blocks messaging a stranger from another group, allows it after becoming friends', async () => {
    const a = await member('Stranger A');
    const b = await member('Stranger B');
    await group('G1', a);
    await group('G2', b);

    const refused = await send(a, '/api/member/messages/start', { personId: b.id, body: 'Hello' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('NOT_ALLOWED');

    await befriend(a, b);
    const ok = await send(a, '/api/member/messages/start', { personId: b.id, body: 'Hello friend' });
    expect(ok.status).toBe(201);

    // B sees it in their normal private messages, labelled as a member.
    const inbox = await b.agent.get('/api/private-messages/conversations');
    expect(inbox.body.items[0]).toMatchObject({ otherPartyType: 'MEMBER', otherPartyName: 'Stranger A' });
  });

  it('allows people in the same group, and a member writing to their leader', async () => {
    const a = await member('Groupie A');
    const b = await member('Groupie B');
    const leader = await member('Group Leader');
    const g = await group('Same', a, b);
    await makeLeaderOf(leader, g.id);

    expect((await send(a, '/api/member/messages/start', { personId: b.id, body: 'Hi neighbour' })).status).toBe(201);
    expect((await send(a, '/api/member/messages/start', { personId: leader.id, body: 'Hi leader' })).status).toBe(201);
  });

  it('reuses one conversation between two people, whoever starts', async () => {
    const a = await member('Talker A');
    const b = await member('Talker B');
    await group('Chat', a, b);
    const first = await send(a, '/api/member/messages/start', { personId: b.id, body: 'one' });
    const second = await send(b, '/api/member/messages/start', { personId: a.id, body: 'two' });
    expect(second.body.conversationId).toBe(first.body.conversationId);
  });

  it('blocking stops new messages and replies, ends the friendship, and hides the profile', async () => {
    const a = await member('Blocker');
    const b = await member('Blocked');
    await befriend(a, b);
    const start = await send(b, '/api/member/messages/start', { personId: a.id, body: 'hi' });

    await send(a, '/api/member/blocks', { personId: b.id });
    expect(await prisma.friendship.count()).toBe(0);
    expect((await send(b, '/api/member/messages/start', { personId: a.id, body: 'again' })).status).toBe(403);
    const reply = await send(b, `/api/private-messages/conversations/${start.body.conversationId}/messages`, { body: 'reply' });
    expect(reply.status).toBe(403);
    expect((await b.agent.get(`/api/member/people/${a.id}`)).status).toBe(404);
    expect((await send(b, '/api/member/friends/requests', { personId: a.id })).status).toBe(404);

    await a.agent.delete(`/api/member/blocks/${b.id}`).set('X-CSRF-Token', a.csrf);
    expect((await b.agent.get(`/api/member/people/${a.id}`)).status).toBe(200);
  });
});

describe('Finding people', () => {
  const yaounde = { locationCountry: 'Cameroon', locationRegion: 'Centre', locationDivision: 'Mfoundi' };

  it('lists people near me, closest first, without showing anyone’s quarter', async () => {
    const me = await member('Me Here', { ...yaounde, locationSubdivision: 'Yaoundé III', locationQuarter: 'Efoulan' });
    await member('Same Quarter', { ...yaounde, locationSubdivision: 'Yaoundé III', locationQuarter: 'Efoulan' });
    await member('Same Division', { ...yaounde, locationSubdivision: 'Yaoundé I', locationQuarter: 'Bastos' });
    await member('Other Region', { locationCountry: 'Cameroon', locationRegion: 'Littoral', locationDivision: 'Wouri' });

    const res = await me.agent.get('/api/member/people/near');
    expect(res.body.items.map((p: any) => p.name)).toEqual(['Same Quarter', 'Same Division']);
    expect(JSON.stringify(res.body)).not.toContain('Efoulan');
    expect(JSON.stringify(res.body)).not.toContain('Bastos');
    expect(res.body.items[0].area).toBe('Yaoundé III, Centre');
  });

  it('searches by name and suggests friends of friends', async () => {
    const a = await member('Searcher');
    const b = await member('Middle Friend');
    const c = await member('Friend Of Friend');
    await befriend(a, b);
    await befriend(b, c);

    const found = await a.agent.get('/api/member/people?search=of fri');
    expect(found.body.items.map((p: any) => p.name)).toEqual(['Friend Of Friend']);

    const suggested = await a.agent.get('/api/member/people/suggested');
    expect(suggested.body.items).toEqual([expect.objectContaining({ name: 'Friend Of Friend', mutualFriends: 1, friendStatus: 'NONE' })]);
  });

  it('shows a profile card with friend status and whether I can message', async () => {
    const a = await member('Viewer');
    const b = await member('Viewed');
    const card = await a.agent.get(`/api/member/people/${b.id}`);
    expect(card.body).toMatchObject({ name: 'Viewed', friendStatus: 'NONE', canMessage: false, friendCount: 0 });
  });
});

describe('Updates feed — Friends view', () => {
  it('shows only friends’ posts (and my own) in the Friends view', async () => {
    const a = await member('Feed Me');
    const f = await member('Feed Friend');
    const s = await member('Feed Stranger');
    await befriend(a, f);
    for (const [who, body] of [
      [a, 'mine'],
      [f, 'friend post'],
      [s, 'stranger post'],
    ] as const) {
      await prisma.updatePost.create({ data: { authorPersonId: who.id, body } });
    }
    const friendsView = await a.agent.get('/api/updates?friends=true');
    expect(friendsView.body.items.map((i: any) => i.body).sort()).toEqual(['friend post', 'mine']);
    const everyone = await a.agent.get('/api/updates');
    expect(everyone.body.items).toHaveLength(3);
  });

  it('hides posts from people I blocked', async () => {
    const a = await member('Feed Blocker');
    const b = await member('Feed Blocked');
    await prisma.updatePost.create({ data: { authorPersonId: b.id, body: 'hidden' } });
    await send(a, '/api/member/blocks', { personId: b.id });
    expect((await a.agent.get('/api/updates')).body.items).toEqual([]);
  });
});

describe('Reports', () => {
  async function loginAdmin() {
    const email = `reports-admin-${n}@test.local`;
    await createAdmin(email, 'AdminPass123!');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
    return { agent, csrf };
  }

  async function loginLeaderAccount(personId: string) {
    n += 1;
    const email = `leader-acct-${n}@test.local`;
    await prisma.user.create({
      data: { name: 'Leader Account', email, passwordHash: await bcrypt.hash('LeaderPass123!', 10), role: 'LEADER', active: true, personId },
    });
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'LeaderPass123!' });
    return { agent, csrf };
  }

  it('lets a member report someone; admin sees and resolves it; the right leader sees it too', async () => {
    const reporter = await member('Reporter');
    const reported = await member('Troublemaker');
    const leaderPerson = await member('Their Leader');
    const otherLeaderPerson = await member('Other Leader');
    const g = await group('Trouble group', reported);
    const other = await group('Other group');
    await makeLeaderOf(leaderPerson, g.id);
    await makeLeaderOf(otherLeaderPerson, other.id);

    const r = await send(reporter, '/api/member/reports', { personId: reported.id, reason: 'Asked me for money' });
    expect(r.status).toBe(201);

    const admin = await loginAdmin();
    const list = await admin.agent.get('/api/admin/member-reports');
    expect(list.body.items[0]).toMatchObject({ reason: 'Asked me for money', reported: { name: 'Troublemaker' }, status: 'OPEN' });

    const leader = await loginLeaderAccount(leaderPerson.id);
    expect((await leader.agent.get('/api/leader/member-reports')).body.items).toHaveLength(1);
    const otherLeader = await loginLeaderAccount(otherLeaderPerson.id);
    expect((await otherLeader.agent.get('/api/leader/member-reports')).body.items).toHaveLength(0);
    expect((await otherLeader.agent.post(`/api/leader/member-reports/${r.body.id}/resolve`).set('X-CSRF-Token', otherLeader.csrf).send({})).status).toBe(404);

    await admin.agent.post(`/api/admin/member-reports/${r.body.id}/resolve`).set('X-CSRF-Token', admin.csrf).send({ note: 'Spoke with them' });
    expect((await admin.agent.get('/api/admin/member-reports')).body.items).toHaveLength(0);
    expect((await admin.agent.get('/api/admin/member-reports?status=RESOLVED')).body.items[0].resolutionNote).toBe('Spoke with them');
  });

  it('requires a reason', async () => {
    const a = await member('Lazy Reporter');
    const b = await member('Someone');
    expect((await send(a, '/api/member/reports', { personId: b.id, reason: '' })).status).toBe(400);
  });
});

describe('Broadcast options', () => {
  it('lets the admin message all leaders at once', async () => {
    const l1 = await member('Leader One');
    const l2 = await member('Leader Two');
    const plain = await member('Plain Member');
    const g = await group('Broadcast group', plain);
    await makeLeaderOf(l1, g.id);
    await makeLeaderOf(l2, g.id);

    const email = `bcast-admin-${n}@test.local`;
    await createAdmin(email, 'AdminPass123!');
    const admin = agentWithUniqueIp();
    const { csrf } = await bootstrap(admin as any);
    await admin.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });

    const res = await admin.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'ALL_LEADERS', body: 'Leaders meeting tonight' });
    expect(res.status).toBe(201);
    expect(res.body.targetCount).toBe(2);
    expect(await prisma.privateConversation.count({ where: { memberPersonId: plain.id } })).toBe(0);
  });
});
