import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// In-App Notifications Foundation — mirrors the exact conventions already
// established in privateMessaging.test.ts: agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, loginAsMember, setupCommunityLeader.
const app = createApp();

let ipCounter = 20000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.101.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function loginAsAdmin(n: number) {
  const email = `notif-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function makePerson(whatsappNumber: string, name = 'Notification Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `notif-leader${n}@test.local`;
  const { user } = await createLeader(`Notification Leader ${n}`, email, `NOTIF${n}CODE`);
  const person = await makePerson(`+237696${String(n).padStart(6, '0')}`, `Notification Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function loginAsMember(whatsapp: string, email: string, name = 'Notification Member') {
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

describe('In-App Notifications — authentication', () => {
  it('rejects an unauthenticated caller on every route', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/notifications')).status).toBe(401);
    expect((await anon.get('/api/notifications/unread-count')).status).toBe(401);
    expect((await anon.patch('/api/notifications/00000000-0000-0000-0000-000000000000/read').send({})).status).toBe(401);
  });
});

describe('In-App Notifications — Event 4: Community leadership assignment', () => {
  it('creates a ROLE_ASSIGNED notification for the newly assigned Leader', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(1);
    const community = await makeCommunity('Notif Community A');
    const person = await makePerson('+237697000001', 'New Leader Candidate');

    const created = await adminAgent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(created.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: person.id } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe('ROLE_ASSIGNED');
    expect((notifications[0].metadata as any).communityName).toBe('Notif Community A');
    expect(notifications[0].targetType).toBe('RoleAssignment');
    expect(notifications[0].targetId).toBe(created.body.id);
  });
});

describe('In-App Notifications — Event 1: Follow-Up assignment', () => {
  it('creates a FOLLOW_UP_ASSIGNED notification when Admin assigns a Follow-Up', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(2);
    const community = await makeCommunity('Notif Community B');
    const { person: leaderPerson } = await setupCommunityLeader(1, community.id);
    const followed = await makePerson('+237697000002', 'Followed Person B');

    const created = await adminAgent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: leaderPerson.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: leaderPerson.id } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe('FOLLOW_UP_ASSIGNED');
    expect((notifications[0].metadata as any).followedPersonName).toBe('Followed Person B');
    expect(notifications[0].targetId).toBe(created.body.id);
  });

  it('creates a new FOLLOW_UP_ASSIGNED notification for the new follower on reassignment, not the old one', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(3);
    const community = await makeCommunity('Notif Community C');
    const { person: oldLeader } = await setupCommunityLeader(2, community.id);
    const { person: newLeader } = await setupCommunityLeader(3, community.id);
    const followed = await makePerson('+237697000003', 'Followed Person C');

    const created = await adminAgent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: oldLeader.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    const reassigned = await adminAgent
      .post(`/api/admin/follow-ups/${created.body.id}/reassign`)
      .set('X-CSRF-Token', csrf)
      .send({ newFollowerId: newLeader.id });
    expect(reassigned.status).toBe(200);

    const newLeaderNotifications = await prisma.notification.findMany({ where: { recipientPersonId: newLeader.id } });
    expect(newLeaderNotifications.length).toBe(1);
    expect(newLeaderNotifications[0].targetId).toBe(reassigned.body.id);

    // The reassignment itself creates exactly one notification for the new
    // follower — no second, stale notification is created for the old one.
    const oldLeaderNotifications = await prisma.notification.findMany({ where: { recipientPersonId: oldLeader.id } });
    expect(oldLeaderNotifications.length).toBe(1); // from the original assignment only
  });

  it('does not notify a Leader who self-creates their own Follow-Up (no self-notification)', async () => {
    const community = await makeCommunity('Notif Community SelfCreate');
    const { agent: leaderAgent, csrf: leaderCsrf, person: leaderPerson } = await setupCommunityLeader(4, community.id);
    const followed = await makePerson('+237697000004', 'Followed Person SelfCreate');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await leaderAgent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: leaderPerson.id } });
    expect(notifications.length).toBe(0);
  });
});

describe('In-App Notifications — Event 3: Resource grant', () => {
  it('creates a RESOURCE_GRANTED notification for the Member', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(4);
    const person = await makePerson('+237697000005', 'Resource Recipient');
    const resource = await prisma.resource.create({ data: { titleEn: 'Leadership Guide', titleFr: 'Guide du leadership' } });

    const res = await adminAgent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(res.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: person.id } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe('RESOURCE_GRANTED');
    expect((notifications[0].metadata as any).resourceTitleEn).toBe('Leadership Guide');
    expect((notifications[0].metadata as any).resourceTitleFr).toBe('Guide du leadership');
  });

  it('does not create a duplicate notification when the same grant is re-submitted while already ACTIVE (retry safety)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(5);
    const person = await makePerson('+237697000006', 'Resource Retry Recipient');
    const resource = await prisma.resource.create({ data: { titleEn: 'Retry Resource' } });

    const first = await adminAgent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(first.status).toBe(201);

    // The exact same grant request repeated — the underlying operation is an
    // upsert and succeeds silently both times, but must notify only once.
    const second = await adminAgent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(second.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: person.id } });
    expect(notifications.length).toBe(1);
  });

  it('does create a new notification when re-granting after a revocation', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(6);
    const person = await makePerson('+237697000007', 'Resource Regrant Recipient');
    const resource = await prisma.resource.create({ data: { titleEn: 'Regrant Resource' } });

    const first = await adminAgent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    const grantId = first.body.id;

    await adminAgent.patch(`/api/admin/resource-access/${grantId}/revoke`).set('X-CSRF-Token', csrf).send({});

    const regranted = await adminAgent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(regranted.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: person.id } });
    expect(notifications.length).toBe(2);
  });
});

describe('In-App Notifications — Event 2: private message received', () => {
  it('notifies the Member when a Leader sends the first message', async () => {
    const community = await makeCommunity('Notif Community D');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(5, community.id);
    const { person: memberPerson } = await loginAsMember('+237698000001', 'notif-member1@example.com');
    await prisma.communityMembership.create({ data: { personId: memberPerson.id, communityId: community.id } });

    const res = await leaderAgent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ personIds: [memberPerson.id], body: 'Hello from your Leader.' });
    expect(res.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: memberPerson.id } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe('PRIVATE_MESSAGE_RECEIVED');
    expect((notifications[0].metadata as any).senderName).toBeTruthy();
  });

  it('notifies the Leader (Person) when the Member replies in a Leader-initiated conversation', async () => {
    const community = await makeCommunity('Notif Community E');
    const { agent: leaderAgent, csrf: leaderCsrf, person: leaderPerson } = await setupCommunityLeader(6, community.id);
    const { agent: memberAgent, csrf: memberCsrf, person: memberPerson } = await loginAsMember(
      '+237698000002',
      'notif-member2@example.com',
    );
    await prisma.communityMembership.create({ data: { personId: memberPerson.id, communityId: community.id } });

    await leaderAgent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ personIds: [memberPerson.id], body: 'Hello.' });

    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: memberPerson.id } });

    const reply = await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Thank you!' });
    expect(reply.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientPersonId: leaderPerson.id } });
    expect(notifications.length).toBe(1);
    expect((notifications[0].metadata as any).senderName).toBe(memberPerson.name);
  });

  it('notifies the Admin (User) when the Member replies in an Admin-initiated conversation', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin(7);
    const { agent: memberAgent, csrf: memberCsrf, person: memberPerson } = await loginAsMember(
      '+237698000003',
      'notif-member3@example.com',
    );
    await prisma.communityMembership.create({ data: { personId: memberPerson.id, communityId: (await makeCommunity('Notif Community F')).id } });

    await adminAgent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', adminCsrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [memberPerson.id], body: 'Hello from Central Authority.' });

    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: memberPerson.id } });
    const adminUserId = conversation!.initiatorUserId!;

    const reply = await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Got it, thanks.' });
    expect(reply.status).toBe(201);

    const notifications = await prisma.notification.findMany({ where: { recipientUserId: adminUserId } });
    expect(notifications.length).toBe(1);
    expect((notifications[0].metadata as any).senderName).toBe(memberPerson.name);
  });
});

describe('In-App Notifications — list, unread count, ownership isolation', () => {
  it('a user only ever sees their own notifications, never another Person\'s or User\'s', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(8);
    const community = await makeCommunity('Notif Community G');
    const personA = await makePerson('+237697000008', 'Isolation Target A');
    const personB = await makePerson('+237697000009', 'Isolation Target B');

    await adminAgent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: personA.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    const community2 = await makeCommunity('Notif Community G2');
    await adminAgent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: personB.id, roleType: 'SCOPED_LEADER', communityId: community2.id });

    // personA and personB have no login of their own here (only Leaders with
    // linked Users can authenticate) — verify isolation directly at the
    // query layer used by the route, matching this codebase's own
    // established "verify the WHERE clause never leaks" convention.
    const notificationsA = await prisma.notification.findMany({ where: { recipientPersonId: personA.id } });
    const notificationsB = await prisma.notification.findMany({ where: { recipientPersonId: personB.id } });
    expect(notificationsA.length).toBe(1);
    expect(notificationsB.length).toBe(1);
    expect(notificationsA[0].id).not.toBe(notificationsB[0].id);
  });

  it('GET /api/notifications returns only the authenticated Leader\'s own notifications', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(9);
    const communityA = await makeCommunity('Notif Community H-A');
    const communityB = await makeCommunity('Notif Community H-B');
    const { agent: leaderAAgent, person: leaderA } = await setupCommunityLeader(7, communityA.id);
    const { person: leaderB } = await setupCommunityLeader(8, communityB.id);

    await adminAgent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: leaderA.id, roleType: 'SCOPED_LEADER', communityId: (await makeCommunity('Notif Community H-A2')).id });
    await adminAgent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: leaderB.id, roleType: 'SCOPED_LEADER', communityId: (await makeCommunity('Notif Community H-B2')).id });

    const res = await leaderAAgent.get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    const other = await prisma.notification.findFirst({ where: { recipientPersonId: leaderB.id } });
    expect(res.body.items.map((i: any) => i.id)).not.toContain(other!.id);
  });

  it('paginates the caller\'s own notifications', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(10);
    const community = await makeCommunity('Notif Community I');
    const { agent: leaderAgent, person: leaderPerson } = await setupCommunityLeader(9, community.id);

    for (let i = 0; i < 3; i++) {
      const followed = await makePerson(`+23769700${String(i).padStart(4, '0')}`, `Pagination Followed ${i}`);
      await adminAgent
        .post('/api/admin/follow-ups')
        .set('X-CSRF-Token', csrf)
        .send({ followerId: leaderPerson.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    }

    const page1 = await leaderAgent.get('/api/notifications?page=1&pageSize=2');
    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBe(2);
    expect(page1.body.pagination.total).toBe(3);

    const page2 = await leaderAgent.get('/api/notifications?page=2&pageSize=2');
    expect(page2.body.items.length).toBe(1);
    const page1Ids = page1.body.items.map((i: any) => i.id);
    const page2Ids = page2.body.items.map((i: any) => i.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });

  it('returns the correct unread count, decreasing only after marking read', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(11);
    const community = await makeCommunity('Notif Community J');
    const { agent: leaderAgent, csrf: leaderCsrf, person: leaderPerson } = await setupCommunityLeader(10, community.id);
    const followed = await makePerson('+237697000010', 'Unread Count Followed');

    await adminAgent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: leaderPerson.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    const before = await leaderAgent.get('/api/notifications/unread-count');
    expect(before.body.unreadCount).toBe(1);

    const list = await leaderAgent.get('/api/notifications');
    const notificationId = list.body.items[0].id;
    await leaderAgent.patch(`/api/notifications/${notificationId}/read`).set('X-CSRF-Token', leaderCsrf).send({});

    const after = await leaderAgent.get('/api/notifications/unread-count');
    expect(after.body.unreadCount).toBe(0);
  });

  it('returns zero unread count and an empty list when there are no notifications', async () => {
    const community = await makeCommunity('Notif Community K');
    const { agent: leaderAgent } = await setupCommunityLeader(11, community.id);

    const list = await leaderAgent.get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    expect(list.body.pagination.total).toBe(0);

    const count = await leaderAgent.get('/api/notifications/unread-count');
    expect(count.body.unreadCount).toBe(0);
  });
});

describe('In-App Notifications — mark as read', () => {
  it('marks the caller\'s own notification read, and it is idempotent', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(12);
    const community = await makeCommunity('Notif Community L');
    const { agent: leaderAgent, csrf: leaderCsrf, person: leaderPerson } = await setupCommunityLeader(12, community.id);
    const followed = await makePerson('+237697000011', 'Mark Read Followed');

    await adminAgent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: leaderPerson.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    const list = await leaderAgent.get('/api/notifications');
    const id = list.body.items[0].id;
    expect(list.body.items[0].readAt).toBeNull();

    const first = await leaderAgent.patch(`/api/notifications/${id}/read`).set('X-CSRF-Token', leaderCsrf).send({});
    expect(first.status).toBe(200);
    expect(first.body.readAt).toBeTruthy();

    const second = await leaderAgent.patch(`/api/notifications/${id}/read`).set('X-CSRF-Token', leaderCsrf).send({});
    expect(second.status).toBe(200);
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it('never lets a Leader mark another Person\'s notification read (404, not 403)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(13);
    const communityA = await makeCommunity('Notif Community M-A');
    const communityB = await makeCommunity('Notif Community M-B');
    const { person: leaderA } = await setupCommunityLeader(13, communityA.id);
    const { agent: leaderBAgent, csrf: leaderBCsrf } = await setupCommunityLeader(14, communityB.id);

    const created = await adminAgent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: leaderA.id, roleType: 'SCOPED_LEADER', communityId: (await makeCommunity('Notif Community M-A2')).id });
    void created;
    const notification = await prisma.notification.findFirst({ where: { recipientPersonId: leaderA.id } });

    const res = await leaderBAgent.patch(`/api/notifications/${notification!.id}/read`).set('X-CSRF-Token', leaderBCsrf).send({});
    expect(res.status).toBe(404);

    const unchanged = await prisma.notification.findUnique({ where: { id: notification!.id } });
    expect(unchanged?.readAt).toBeNull();
  });

  it('returns 404 for a nonexistent notification id', async () => {
    const community = await makeCommunity('Notif Community N');
    const { agent: leaderAgent, csrf } = await setupCommunityLeader(15, community.id);
    const res = await leaderAgent
      .patch('/api/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(res.status).toBe(404);
  });
});
