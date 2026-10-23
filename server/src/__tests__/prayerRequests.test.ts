import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 2 — Prayer requests. Mirrors privateMessaging.test.ts's own
// conventions (agentWithUniqueIp, setupCommunityLeader, loginAsMember,
// loginAsAdmin) since the PRIVATE visibility rule needs the exact same
// "Leader linked to a Person with an ACTIVE SCOPED_LEADER role for one
// exact Community" setup that file already established.

const app = createApp();

let ipCounter = 40000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.130.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

let n = 0;
async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(communityId: string, status: 'ACTIVE' | 'ENDED' = 'ACTIVE') {
  n += 1;
  const email = `pr-leader${n}@test.local`;
  const { user } = await createLeader(`PR Leader ${n}`, email, `PR${n}CODE`);
  const person = await prisma.person.create({ data: { name: `PR Leader Person ${n}`, whatsappNumber: `+237695${String(n).padStart(6, '0')}` } });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId, status },
  });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function loginAsMember(name = 'PR Member') {
  n += 1;
  const whatsapp = `+237690${String(n).padStart(6, '0')}`;
  const email = `pr-member${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

async function loginAsAdmin() {
  n += 1;
  const email = `pr-admin${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

describe('Prayer requests — authentication', () => {
  it('an unauthenticated caller cannot list prayer requests', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/prayer-requests')).status).toBe(401);
  });

  it('an unauthenticated caller cannot create a prayer request (rejected by CSRF before auth, same ordering as /api/updates)', async () => {
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const res = await anon.post('/api/prayer-requests').set('X-CSRF-Token', csrf).send({ body: 'Pray for me', visibility: 'PUBLIC' });
    expect(res.status).toBe(401);
  });

  it('requires CSRF to create a prayer request', async () => {
    const m = await loginAsMember();
    const res = await m.agent.post('/api/prayer-requests').send({ body: 'Pray for me', visibility: 'PUBLIC' });
    expect(res.status).toBe(403);
  });

  it('an Admin (no Person identity) cannot create or comment, but can list', async () => {
    const a = await loginAsAdmin();
    const create = await a.agent.post('/api/prayer-requests').set('X-CSRF-Token', a.csrf).send({ body: 'x', visibility: 'PUBLIC' });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('MEMBERS_ONLY');
    const list = await a.agent.get('/api/prayer-requests');
    expect(list.status).toBe(200);
  });
});

describe('Prayer requests — public wall', () => {
  it('a public request is visible to any other signed-in member', async () => {
    const author = await loginAsMember('Author One');
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'Please pray for my family.', visibility: 'PUBLIC' });
    expect(create.status).toBe(201);

    const other = await loginAsMember('Other Member');
    const list = await other.agent.get('/api/prayer-requests?scope=public');
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: any) => i.id === create.body.id)).toBe(true);
    const item = list.body.items.find((i: any) => i.id === create.body.id);
    expect(item.visibility).toBe('PUBLIC');
    expect(item.author.name).toBe('Author One');
    expect(item.canDelete).toBe(false);
  });

  it('the author sees canDelete true on their own public request', async () => {
    const author = await loginAsMember('Self Author');
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'Pray for strength.', visibility: 'PUBLIC' });
    const list = await author.agent.get('/api/prayer-requests?scope=public');
    expect(list.body.items.find((i: any) => i.id === create.body.id).canDelete).toBe(true);
  });

  it('rejects an empty body', async () => {
    const author = await loginAsMember();
    const res = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: '   ', visibility: 'PUBLIC' });
    expect(res.status).toBe(400);
  });
});

describe('Prayer requests — private to leadership', () => {
  it('auto-selects the author\'s sole Community, and only that Community\'s Leader (plus Admin) can see it — not a stranger member, not a Leader of a different Community', async () => {
    const community = await makeCommunity('Buea Prayer Group');
    const otherCommunity = await makeCommunity('Yaounde Prayer Group');
    const author = await loginAsMember('Private Author');
    await makeMembership(author.person.id, community.id);

    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'Please pray privately for me.', visibility: 'PRIVATE' });
    expect(create.status).toBe(201);
    const id = create.body.id;

    // Not on the public feed.
    const publicList = await author.agent.get('/api/prayer-requests?scope=public');
    expect(publicList.body.items.some((i: any) => i.id === id)).toBe(false);

    // The author sees it on their own private tab.
    const authorPrivate = await author.agent.get('/api/prayer-requests?scope=private');
    expect(authorPrivate.body.items.some((i: any) => i.id === id)).toBe(true);
    const item = authorPrivate.body.items.find((i: any) => i.id === id);
    expect(item.community.name).toBe('Buea Prayer Group');

    // A stranger member (not a Leader of this Community) sees nothing.
    const stranger = await loginAsMember('Stranger Member');
    const strangerPrivate = await stranger.agent.get('/api/prayer-requests?scope=private');
    expect(strangerPrivate.body.items.some((i: any) => i.id === id)).toBe(false);

    // A Leader of a DIFFERENT Community sees nothing.
    const otherLeader = await setupCommunityLeader(otherCommunity.id);
    const otherLeaderPrivate = await otherLeader.agent.get('/api/prayer-requests?scope=private');
    expect(otherLeaderPrivate.body.items.some((i: any) => i.id === id)).toBe(false);

    // The exact Community's Leader sees it.
    const leader = await setupCommunityLeader(community.id);
    const leaderPrivate = await leader.agent.get('/api/prayer-requests?scope=private');
    expect(leaderPrivate.body.items.some((i: any) => i.id === id)).toBe(true);

    // Admin sees every PRIVATE request, regardless of Community.
    const admin = await loginAsAdmin();
    const adminPrivate = await admin.agent.get('/api/prayer-requests?scope=private');
    expect(adminPrivate.body.items.some((i: any) => i.id === id)).toBe(true);
  });

  it('rejects PRIVATE with an explicit Community the author does not belong to', async () => {
    const community = await makeCommunity('Not My Community');
    const author = await loginAsMember();
    const res = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE', communityId: community.id });
    expect(res.status).toBe(400);
  });

  it('rejects PRIVATE when the author belongs to no Community yet', async () => {
    const author = await loginAsMember();
    const res = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_COMMUNITY');
  });

  it('requires an explicit Community when the author belongs to several, and accepts the chosen one', async () => {
    const communityA = await makeCommunity('Community A');
    const communityB = await makeCommunity('Community B');
    const author = await loginAsMember();
    await makeMembership(author.person.id, communityA.id);
    await makeMembership(author.person.id, communityB.id);

    const ambiguous = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE' });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.code).toBe('COMMUNITY_REQUIRED');

    const explicit = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE', communityId: communityB.id });
    expect(explicit.status).toBe(201);
  });

  it('notifies the Community\'s ACTIVE Leader on submission, but not a Leader of a different Community, and never for a PUBLIC request', async () => {
    const community = await makeCommunity('Notify Community');
    const otherCommunity = await makeCommunity('Other Notify Community');
    const author = await loginAsMember('Notify Author');
    await makeMembership(author.person.id, community.id);
    const leader = await setupCommunityLeader(community.id);
    const otherLeader = await setupCommunityLeader(otherCommunity.id);

    await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'Please pray for my family privately.', visibility: 'PRIVATE' });

    const leaderNotifications = await leader.agent.get('/api/notifications');
    expect(leaderNotifications.body.items.some((n: any) => n.type === 'PRAYER_REQUEST_SUBMITTED_PRIVATELY')).toBe(true);

    const otherLeaderNotifications = await otherLeader.agent.get('/api/notifications');
    expect(otherLeaderNotifications.body.items.some((n: any) => n.type === 'PRAYER_REQUEST_SUBMITTED_PRIVATELY')).toBe(false);

    // A PUBLIC request never notifies anyone this way.
    await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'A public one.', visibility: 'PUBLIC' });
    const leaderNotificationsAfter = await leader.agent.get('/api/notifications');
    expect(leaderNotificationsAfter.body.items.filter((nn: any) => nn.type === 'PRAYER_REQUEST_SUBMITTED_PRIVATELY')).toHaveLength(1);
  });
});

describe('Prayer requests — deleting', () => {
  it('the author can delete their own request (public or private)', async () => {
    const author = await loginAsMember();
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PUBLIC' });
    const del = await author.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', author.csrf);
    expect(del.status).toBe(200);
    const again = await author.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', author.csrf);
    expect(again.status).toBe(404);
  });

  it('a stranger member cannot delete another member\'s public request', async () => {
    const author = await loginAsMember();
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PUBLIC' });
    const stranger = await loginAsMember();
    const del = await stranger.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', stranger.csrf);
    expect(del.status).toBe(403);
  });

  it('a Leader cannot moderate a PUBLIC request — only Admin can', async () => {
    const community = await makeCommunity('Mod Community');
    const author = await loginAsMember();
    await makeMembership(author.person.id, community.id);
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PUBLIC' });

    const leader = await setupCommunityLeader(community.id);
    const leaderDel = await leader.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', leader.csrf);
    expect(leaderDel.status).toBe(403);

    const admin = await loginAsAdmin();
    const adminDel = await admin.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', admin.csrf);
    expect(adminDel.status).toBe(200);
  });

  it('the exact Community\'s Leader can moderate (delete) a PRIVATE request, but a Leader of a different Community cannot', async () => {
    const community = await makeCommunity('Private Mod Community');
    const otherCommunity = await makeCommunity('Other Private Mod Community');
    const author = await loginAsMember();
    await makeMembership(author.person.id, community.id);
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE' });

    const otherLeader = await setupCommunityLeader(otherCommunity.id);
    const otherDel = await otherLeader.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', otherLeader.csrf);
    expect(otherDel.status).toBe(403);

    const leader = await setupCommunityLeader(community.id);
    const leaderDel = await leader.agent.delete(`/api/prayer-requests/${create.body.id}`).set('X-CSRF-Token', leader.csrf);
    expect(leaderDel.status).toBe(200);
  });
});

describe('Prayer requests — comments', () => {
  it('a member can comment on a public request, and the author is notified (never for their own comment)', async () => {
    const author = await loginAsMember('Comment Author');
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PUBLIC' });

    const commenter = await loginAsMember('Commenter');
    const comment = await commenter.agent.post(`/api/prayer-requests/${create.body.id}/comments`).set('X-CSRF-Token', commenter.csrf).send({ body: 'Praying for you!' });
    expect(comment.status).toBe(201);

    const authorNotifications = await author.agent.get('/api/notifications');
    expect(authorNotifications.body.items.some((nn: any) => nn.type === 'PRAYER_REQUEST_COMMENT')).toBe(true);

    // The author commenting on their own request never notifies themselves.
    await author.agent.post(`/api/prayer-requests/${create.body.id}/comments`).set('X-CSRF-Token', author.csrf).send({ body: 'Thank you all.' });
    const authorNotificationsAfter = await author.agent.get('/api/notifications');
    expect(authorNotificationsAfter.body.items.filter((nn: any) => nn.type === 'PRAYER_REQUEST_COMMENT')).toHaveLength(1);
  });

  it('a stranger cannot see or comment on a PRIVATE request not routed to them (404, not 403)', async () => {
    const community = await makeCommunity('Comment Private Community');
    const author = await loginAsMember();
    await makeMembership(author.person.id, community.id);
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE' });

    const stranger = await loginAsMember();
    const get = await stranger.agent.get(`/api/prayer-requests/${create.body.id}/comments`);
    expect(get.status).toBe(404);
    const post = await stranger.agent.post(`/api/prayer-requests/${create.body.id}/comments`).set('X-CSRF-Token', stranger.csrf).send({ body: 'x' });
    expect(post.status).toBe(404);
  });

  it('the exact Community\'s Leader can read and comment on a PRIVATE request routed to them', async () => {
    const community = await makeCommunity('Leader Comment Community');
    const author = await loginAsMember();
    await makeMembership(author.person.id, community.id);
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PRIVATE' });

    const leader = await setupCommunityLeader(community.id);
    const get = await leader.agent.get(`/api/prayer-requests/${create.body.id}/comments`);
    expect(get.status).toBe(200);
    const post = await leader.agent.post(`/api/prayer-requests/${create.body.id}/comments`).set('X-CSRF-Token', leader.csrf).send({ body: 'We are praying with you.' });
    expect(post.status).toBe(201);
  });

  it('an Admin cannot post a comment (no Person identity)', async () => {
    const author = await loginAsMember();
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PUBLIC' });
    const admin = await loginAsAdmin();
    const res = await admin.agent.post(`/api/prayer-requests/${create.body.id}/comments`).set('X-CSRF-Token', admin.csrf).send({ body: 'x' });
    expect(res.status).toBe(403);
  });

  it('a comment author can delete their own comment; a stranger cannot', async () => {
    const author = await loginAsMember();
    const create = await author.agent.post('/api/prayer-requests').set('X-CSRF-Token', author.csrf).send({ body: 'x', visibility: 'PUBLIC' });
    const commenter = await loginAsMember();
    const comment = await commenter.agent.post(`/api/prayer-requests/${create.body.id}/comments`).set('X-CSRF-Token', commenter.csrf).send({ body: 'x' });

    const stranger = await loginAsMember();
    const strangerDel = await stranger.agent.delete(`/api/prayer-requests/comments/${comment.body.id}`).set('X-CSRF-Token', stranger.csrf);
    expect(strangerDel.status).toBe(403);

    const ownDel = await commenter.agent.delete(`/api/prayer-requests/comments/${comment.body.id}`).set('X-CSRF-Token', commenter.csrf);
    expect(ownDel.status).toBe(200);
  });

  it('404s for a missing comment', async () => {
    const author = await loginAsMember();
    const del = await author.agent.delete('/api/prayer-requests/comments/00000000-0000-0000-0000-000000000000').set('X-CSRF-Token', author.csrf);
    expect(del.status).toBe(404);
  });
});
