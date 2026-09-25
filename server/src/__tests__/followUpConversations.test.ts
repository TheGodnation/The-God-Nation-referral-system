import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3M.2 — Follow-Up Direct Communication. Mirrors the exact
// conventions established in communityConversations.test.ts (Phase 3M.1):
// agentWithUniqueIp, createLeader/createAdmin, bootstrap, loginAsMember.

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.97.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function makePerson(whatsappNumber: string, name = 'FollowUp Conversation Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function setupLeader(n: number) {
  const email = `fuconv-leader${n}@test.local`;
  const { user } = await createLeader(`FollowUp Conversation Leader ${n}`, email, `FC${n}CODE`);
  const person = await makePerson(`+237699${String(n).padStart(6, '0')}`, `FollowUp Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsMember(whatsapp: string, email: string, name = 'FollowUp Conversation Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[0][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

async function makeAssignment(
  followerId: string,
  followedPersonId: string,
  assignedByUserId: string,
  status: 'ACTIVE' | 'CLOSED' = 'ACTIVE',
) {
  return prisma.followUpAssignment.create({
    data: {
      followerId,
      followedPersonId,
      contextType: 'COMMUNITY',
      contextId: (await prisma.community.create({ data: { name: `FU Ctx ${Math.random()}` } })).id,
      assignedByUserId,
      status,
      ...(status === 'CLOSED' ? { closedAt: new Date(), closedByUserId: assignedByUserId } : {}),
    },
  });
}

describe('Phase 3M.2 — Follow-Up Conversation — Leader authorization', () => {
  it('a Leader can read their own Follow-Up conversation', async () => {
    const { agent, person: leaderPerson, user } = await setupLeader(1);
    const followed = await makePerson('+237696100001');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(200);
    expect(res.body.followUpAssignmentId).toBe(assignment.id);
  });

  it('a Leader can send to their own active Follow-Up', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(2);
    const followed = await makePerson('+237696100002');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Hello, checking in.' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Hello, checking in.');
  });

  it('a Leader cannot read another Leader\'s Follow-Up conversation', async () => {
    const { person: leaderAPerson, user: userA } = await setupLeader(3);
    const { agent: agentB } = await setupLeader(4);
    const followed = await makePerson('+237696100003');
    const assignment = await makeAssignment(leaderAPerson.id, followed.id, userA.id);

    const res = await agentB.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Leader cannot send to another Leader\'s Follow-Up conversation', async () => {
    const { person: leaderAPerson, user: userA } = await setupLeader(5);
    const { agent: agentB, csrf: csrfB } = await setupLeader(6);
    const followed = await makePerson('+237696100004');
    const assignment = await makeAssignment(leaderAPerson.id, followed.id, userA.id);

    const res = await agentB
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrfB)
      .send({ body: 'Intrusion attempt.' });
    expect(res.status).toBe(404);
  });

  it('a Leader cannot bypass authorization by guessing/changing the assignment id', async () => {
    const { agent } = await setupLeader(7);
    const res = await agent.get('/api/follow-ups/00000000-0000-0000-0000-000000000000/conversation');
    expect(res.status).toBe(404);
  });

  it('an unauthenticated caller cannot access', async () => {
    const { person: leaderPerson, user } = await setupLeader(8);
    const followed = await makePerson('+237696100005');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const anon = agentWithUniqueIp();
    const res = await anon.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(401);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — Member authorization and discovery', () => {
  it('a Member can discover their own Follow-Up assignments via GET /api/member/me/follow-ups', async () => {
    const { person: leaderPerson, user } = await setupLeader(9);
    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237696200001', 'fuconv1@example.com');
    await makeAssignment(leaderPerson.id, memberPerson.id, user.id);

    const res = await memberAgent.get('/api/member/me/follow-ups');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].follower.id).toBe(leaderPerson.id);
  });

  it('GET /api/member/me/follow-ups never exposes another Member\'s assignments', async () => {
    const { person: leaderPerson, user } = await setupLeader(10);
    const { person: memberPersonA } = await loginAsMember('+237696200002', 'fuconv2@example.com');
    const { agent: agentB } = await loginAsMember('+237696200003', 'fuconv3@example.com');
    await makeAssignment(leaderPerson.id, memberPersonA.id, user.id);

    const res = await agentB.get('/api/member/me/follow-ups');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('a Member can read a conversation where they are the followedPersonId', async () => {
    const { person: leaderPerson, user } = await setupLeader(11);
    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237696200004', 'fuconv4@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPerson.id, user.id);

    const res = await memberAgent.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(200);
  });

  it('a Member can send while the assignment is active', async () => {
    const { person: leaderPerson, user } = await setupLeader(12);
    const { agent: memberAgent, csrf, person: memberPerson } = await loginAsMember('+237696200005', 'fuconv5@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPerson.id, user.id);

    const res = await memberAgent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Thank you for checking on me.' });
    expect(res.status).toBe(201);
  });

  it('a Member cannot read another Member\'s Follow-Up conversation', async () => {
    const { person: leaderPerson, user } = await setupLeader(13);
    const { person: memberPersonA } = await loginAsMember('+237696200006', 'fuconv6@example.com');
    const { agent: agentB } = await loginAsMember('+237696200007', 'fuconv7@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPersonA.id, user.id);

    const res = await agentB.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Member cannot send to another Member\'s Follow-Up conversation', async () => {
    const { person: leaderPerson, user } = await setupLeader(14);
    const { person: memberPersonA } = await loginAsMember('+237696200008', 'fuconv8@example.com');
    const { agent: agentB, csrf: csrfB } = await loginAsMember('+237696200009', 'fuconv9@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPersonA.id, user.id);

    const res = await agentB
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrfB)
      .send({ body: 'Intrusion attempt.' });
    expect(res.status).toBe(404);
  });

  it('a Member cannot enumerate assignments by guessing an id', async () => {
    const { agent } = await loginAsMember('+237696200010', 'fuconv10@example.com');
    const res = await agent.get('/api/follow-ups/00000000-0000-0000-0000-000000000000/conversation');
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — MemberAccount requirement', () => {
  it('a followed Person without a MemberAccount cannot access the conversation (no session can ever represent them)', async () => {
    const { person: leaderPerson, user } = await setupLeader(15);
    const followedNoAccount = await makePerson('+237696300001', 'No Account Person');
    const assignment = await makeAssignment(leaderPerson.id, followedNoAccount.id, user.id);

    // There is no way to authenticate as followedNoAccount (no MemberAccount
    // exists) — an unauthenticated request is the only possible attempt,
    // and it must be rejected exactly like any other unauthenticated call.
    const anon = agentWithUniqueIp();
    const res = await anon.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(401);

    // Confirm no MemberAccount was implicitly created as a side effect.
    const account = await prisma.memberAccount.findUnique({ where: { personId: followedNoAccount.id } });
    expect(account).toBeNull();
  });

  it('having a MemberAccount does not permit access to an unrelated Follow-Up', async () => {
    const { person: leaderPerson, user } = await setupLeader(16);
    const { person: memberPersonA } = await loginAsMember('+237696300002', 'fuconv-acct1@example.com');
    const { agent: agentB } = await loginAsMember('+237696300003', 'fuconv-acct2@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPersonA.id, user.id);

    const res = await agentB.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — lifecycle', () => {
  it('an ACTIVE assignment allows both reads and sends', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(17);
    const followed = await makePerson('+237696400001');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id, 'ACTIVE');

    const readRes = await agent.get(`/api/follow-ups/${assignment.id}/conversation/messages`);
    expect(readRes.status).toBe(200);
    const sendRes = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Still active.' });
    expect(sendRes.status).toBe(201);
  });

  it('a CLOSED assignment allows historical reads but rejects sends', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(18);
    const followed = await makePerson('+237696400002');
    const active = await makeAssignment(leaderPerson.id, followed.id, user.id, 'ACTIVE');
    await agent
      .post(`/api/follow-ups/${active.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Before closing.' });
    await prisma.followUpAssignment.update({
      where: { id: active.id },
      data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: user.id },
    });

    const readRes = await agent.get(`/api/follow-ups/${active.id}/conversation/messages`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.items.map((m: any) => m.body)).toContain('Before closing.');

    const sendRes = await agent
      .post(`/api/follow-ups/${active.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'After closing.' });
    expect(sendRes.status).toBe(409);
  });

  it('a former follower retains historical access to a closed assignment', async () => {
    const { agent, person: leaderPerson, user } = await setupLeader(19);
    const followed = await makePerson('+237696400003');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id, 'CLOSED');

    const res = await agent.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(200);
  });

  it('reassignment: the new follower does not inherit the old assignment\'s conversation, and gets a separate one', async () => {
    const { agent: agentOld, csrf: csrfOld, person: oldLeaderPerson, user: userOld } = await setupLeader(20);
    const { agent: agentNew, person: newLeaderPerson } = await setupLeader(21);
    const { person: memberPerson } = await loginAsMember('+237696400004', 'fuconv-reassign@example.com');

    // Give the new leader a RoleAssignment matching the old assignment's
    // context, as the real reassign route requires.
    const community = await prisma.community.create({ data: { name: 'Reassign Community' } });
    await prisma.roleAssignment.create({
      data: { personId: newLeaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: userOld.id, communityId: community.id },
    });
    const oldAssignment = await prisma.followUpAssignment.create({
      data: {
        followerId: oldLeaderPerson.id,
        followedPersonId: memberPerson.id,
        contextType: 'COMMUNITY',
        contextId: community.id,
        assignedByUserId: userOld.id,
      },
    });

    await agentOld
      .post(`/api/follow-ups/${oldAssignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrfOld)
      .send({ body: 'Message on the old assignment.' });

    const reassignRes = await agentOld
      .post(`/api/leader/follow-ups/${oldAssignment.id}/reassign`)
      .set('X-CSRF-Token', csrfOld)
      .send({ newFollowerId: newLeaderPerson.id });
    expect(reassignRes.status).toBe(200);
    const newAssignmentId = reassignRes.body.id;
    expect(newAssignmentId).not.toBe(oldAssignment.id);

    // Old follower keeps read-only access to the old, now-closed assignment.
    const oldRead = await agentOld.get(`/api/follow-ups/${oldAssignment.id}/conversation/messages`);
    expect(oldRead.status).toBe(200);
    expect(oldRead.body.items.map((m: any) => m.body)).toContain('Message on the old assignment.');
    const oldSendAttempt = await agentOld
      .post(`/api/follow-ups/${oldAssignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrfOld)
      .send({ body: 'Should be rejected.' });
    expect(oldSendAttempt.status).toBe(409);

    // Old follower has no access to the NEW assignment's conversation.
    const oldFollowerOnNew = await agentOld.get(`/api/follow-ups/${newAssignmentId}/conversation`);
    expect(oldFollowerOnNew.status).toBe(404);

    // New follower's conversation starts independently (no old messages).
    const newRead = await agentNew.get(`/api/follow-ups/${newAssignmentId}/conversation/messages`);
    expect(newRead.status).toBe(200);
    expect(newRead.body.items).toHaveLength(0);

    // The followed Member (same person throughout reassignment) sees an
    // independent, empty conversation on the new assignment — the old
    // message never appears there.
    const memberOnNewAgent = agentWithUniqueIp();
    const { csrf: memberCsrf } = await bootstrap(memberOnNewAgent as any);
    // Re-authenticate the same followed Member via a fresh session to read
    // the new assignment's conversation from their side.
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await memberOnNewAgent
      .post('/api/member/auth/request-link')
      .set('X-CSRF-Token', memberCsrf)
      .send({ whatsapp: '+237696400004', email: 'fuconv-reassign@example.com' });
    const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
    spy.mockRestore();
    await memberOnNewAgent
      .post('/api/member/auth/consume')
      .set('X-CSRF-Token', memberCsrf)
      .send({ token: extractToken(link) });

    const memberNewRead = await memberOnNewAgent.get(`/api/follow-ups/${newAssignmentId}/conversation/messages`);
    expect(memberNewRead.status).toBe(200);
    expect(memberNewRead.body.items).toHaveLength(0);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — FollowUpContact isolation', () => {
  it('a Member cannot access the Leader/Admin FollowUpContact routes at all', async () => {
    const { person: leaderPerson, user } = await setupLeader(22);
    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237696500001', 'fuconv-contact1@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPerson.id, user.id);

    const leaderRoute = await memberAgent.get(`/api/leader/follow-ups/${assignment.id}/contacts`);
    expect(leaderRoute.status).toBe(401);
    const adminRoute = await memberAgent.get(`/api/admin/follow-ups/${assignment.id}/contacts`);
    expect(adminRoute.status).toBe(401);
  });

  it('the conversation message response never includes FollowUpContact fields', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(23);
    const followed = await makePerson('+237696500002');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'A normal message.' });

    const res = await agent.get(`/api/follow-ups/${assignment.id}/conversation/messages`);
    expect(res.status).toBe(200);
    const message = res.body.items[0];
    expect(message).not.toHaveProperty('wellbeingStatus');
    expect(message).not.toHaveProperty('note');
    expect(Object.keys(message).sort()).toEqual(['body', 'createdAt', 'id', 'senderName'].sort());
  });

  it('logging a FollowUpContact still works normally alongside messaging', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(24);
    const followed = await makePerson('+237696500003');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'A message.' });

    const contactRes = await agent
      .post(`/api/leader/follow-ups/${assignment.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'GOOD', note: 'Doing well.' });
    expect(contactRes.status).toBe(201);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — message integrity', () => {
  it('the sender is always derived from the authenticated session', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(25);
    const followed = await makePerson('+237696600001');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'From the leader.' });
    const stored = await prisma.followUpMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(leaderPerson.id);
  });

  it('a client cannot impersonate another Person by supplying a sender id', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(26);
    const followed = await makePerson('+237696600002');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    const other = await makePerson('+237696600003', 'Someone Else');

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Impersonation attempt.', senderPersonId: other.id });
    const stored = await prisma.followUpMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(leaderPerson.id);
  });

  it('an empty message is rejected', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(27);
    const followed = await makePerson('+237696600004');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: '' });
    expect(res.status).toBe(400);
  });

  it('a message over 2000 characters is rejected', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(28);
    const followed = await makePerson('+237696600005');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('an invalid pagination cursor is safely rejected', async () => {
    const { agent, person: leaderPerson, user } = await setupLeader(29);
    const followed = await makePerson('+237696600006');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent.get(`/api/follow-ups/${assignment.id}/conversation/messages?before=not-a-real-id`);
    expect(res.status).toBe(400);
  });

  it('CSRF protection is enforced on message send', async () => {
    const { agent, person: leaderPerson, user } = await setupLeader(30);
    const followed = await makePerson('+237696600007');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const res = await agent.post(`/api/follow-ups/${assignment.id}/conversation/messages`).send({ body: 'No CSRF.' });
    expect(res.status).toBe(403);
  });

  it('the dedicated Follow-Up message-send rate limiter applies', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(31);
    const followed = await makePerson('+237696600008');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ body: `Message ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — cross-scope isolation', () => {
  it('holding a Community RoleAssignment for the same context does not grant Follow-Up conversation access', async () => {
    const community = await prisma.community.create({ data: { name: 'Cross-Scope Community' } });
    const { person: actualFollowerPerson, user: actualFollowerUser } = await setupLeader(32);
    const { agent: otherLeaderAgent, person: otherLeaderPerson } = await setupLeader(33);
    // otherLeaderPerson holds an ACTIVE RoleAssignment for the SAME
    // Community used as this assignment's context, but is not its follower.
    await prisma.roleAssignment.create({
      data: { personId: otherLeaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: actualFollowerUser.id, communityId: community.id },
    });
    const followed = await makePerson('+237696700001');
    const assignment = await prisma.followUpAssignment.create({
      data: {
        followerId: actualFollowerPerson.id,
        followedPersonId: followed.id,
        contextType: 'COMMUNITY',
        contextId: community.id,
        assignedByUserId: actualFollowerUser.id,
      },
    });

    const res = await otherLeaderAgent.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.2 — Follow-Up Conversation — uniqueness and eager creation', () => {
  it('creating a Follow-Up via the Leader route creates its conversation eagerly', async () => {
    const community = await prisma.community.create({ data: { name: 'Eager Creation Community' } });
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(34);
    await prisma.roleAssignment.create({
      data: { personId: leaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId: community.id },
    });
    const followed = await makePerson('+237696800001');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(res.status).toBe(201);

    const conversation = await prisma.followUpConversation.findUnique({ where: { followUpAssignmentId: res.body.id } });
    expect(conversation).toBeTruthy();
  });

  it('a FollowUpAssignment cannot receive more than one FollowUpConversation', async () => {
    const { person: leaderPerson, user } = await setupLeader(35);
    const followed = await makePerson('+237696800002');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    await prisma.followUpConversation.create({ data: { followUpAssignmentId: assignment.id } });

    await expect(prisma.followUpConversation.create({ data: { followUpAssignmentId: assignment.id } })).rejects.toThrow();
  });
});

describe('Phase 3M.7 — Follow-Up Conversation — read state', () => {
  it('the follower can mark the conversation read', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(36);
    const followed = await makePerson('+237696900001');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    const msg = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'From the followed.' },
    });

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it('the followed Member can mark the conversation read', async () => {
    const { person: leaderPerson, user } = await setupLeader(37);
    const { agent, csrf, person: memberPerson } = await loginAsMember('+237696900002', 'read37@example.com');
    const assignment = await makeAssignment(leaderPerson.id, memberPerson.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    const msg = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: leaderPerson.id, body: 'From the leader.' },
    });

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);
  });

  it('an unrelated Leader cannot mark another Leader\'s Follow-Up conversation read', async () => {
    const { person: leaderAPerson, user: userA } = await setupLeader(38);
    const { agent: agentB, csrf: csrfB } = await setupLeader(39);
    const followed = await makePerson('+237696900003');
    const assignment = await makeAssignment(leaderAPerson.id, followed.id, userA.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    const msg = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'x' },
    });

    const res = await agentB
      .post(`/api/follow-ups/${assignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrfB)
      .send({ messageId: msg.id });
    expect(res.status).toBe(404);
  });

  it('marking read remains available for a CLOSED assignment\'s original participants (unlike sending)', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(40);
    const followed = await makePerson('+237696900004');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id, 'CLOSED');
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    const msg = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'historical' },
    });

    const res = await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);

    // Marking read never reopens the assignment.
    const stillClosed = await prisma.followUpAssignment.findUnique({ where: { id: assignment.id } });
    expect(stillClosed!.status).toBe('CLOSED');
  });

  it('reassignment: the old follower\'s read state is never transferred to the new follower', async () => {
    const { agent: agentOld, csrf: csrfOld, person: oldLeaderPerson, user: userOld } = await setupLeader(41);
    const { agent: agentNew, person: newLeaderPerson } = await setupLeader(42);
    const { person: memberPerson } = await loginAsMember('+237696900005', 'read41@example.com');

    const community = await prisma.community.create({ data: { name: 'Read Reassign Community' } });
    await prisma.roleAssignment.create({
      data: { personId: newLeaderPerson.id, roleType: 'SCOPED_LEADER', assignedByUserId: userOld.id, communityId: community.id },
    });
    const oldAssignment = await prisma.followUpAssignment.create({
      data: {
        followerId: oldLeaderPerson.id,
        followedPersonId: memberPerson.id,
        contextType: 'COMMUNITY',
        contextId: community.id,
        assignedByUserId: userOld.id,
      },
    });
    const oldConversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: oldAssignment.id },
      create: { followUpAssignmentId: oldAssignment.id },
      update: {},
    });
    const oldMsg = await prisma.followUpMessage.create({
      data: { conversationId: oldConversation.id, senderPersonId: memberPerson.id, body: 'old conversation message' },
    });
    await agentOld
      .post(`/api/follow-ups/${oldAssignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrfOld)
      .send({ messageId: oldMsg.id });

    const reassignRes = await agentOld
      .post(`/api/leader/follow-ups/${oldAssignment.id}/reassign`)
      .set('X-CSRF-Token', csrfOld)
      .send({ newFollowerId: newLeaderPerson.id });
    expect(reassignRes.status).toBe(200);
    const newAssignmentId = reassignRes.body.id;

    const newConversation = await prisma.followUpConversation.findUnique({ where: { followUpAssignmentId: newAssignmentId } });
    const newFollowerRead = await prisma.followUpConversationRead.findUnique({
      where: { personId_conversationId: { personId: newLeaderPerson.id, conversationId: newConversation!.id } },
    });
    expect(newFollowerRead).toBeNull();

    // The old follower's read row stays tied to the old conversation id.
    const oldFollowerRead = await prisma.followUpConversationRead.findUnique({
      where: { personId_conversationId: { personId: oldLeaderPerson.id, conversationId: oldConversation.id } },
    });
    expect(oldFollowerRead).toBeTruthy();

    // New follower's unread count on the new conversation is unaffected by
    // the old conversation's history.
    const newRes = await agentNew.get(`/api/follow-ups/${newAssignmentId}/conversation`);
    expect(newRes.body.unreadCount).toBe(0);
  });

  it('a messageId from a different conversation is rejected (IDOR)', async () => {
    const { agent: agentA, csrf: csrfA, person: leaderAPerson, user: userA } = await setupLeader(43);
    const followedA = await makePerson('+237696900006');
    const assignmentA = await makeAssignment(leaderAPerson.id, followedA.id, userA.id);

    const followedB = await makePerson('+237696900007');
    const assignmentB = await makeAssignment(leaderAPerson.id, followedB.id, userA.id);
    const conversationB = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignmentB.id },
      create: { followUpAssignmentId: assignmentB.id },
      update: {},
    });
    const msgInB = await prisma.followUpMessage.create({
      data: { conversationId: conversationB.id, senderPersonId: followedB.id, body: 'In B' },
    });

    const res = await agentA
      .post(`/api/follow-ups/${assignmentA.id}/conversation/read`)
      .set('X-CSRF-Token', csrfA)
      .send({ messageId: msgInB.id });
    expect(res.status).toBe(400);
  });

  it('GET requests never write read state', async () => {
    const { agent, person: leaderPerson, user } = await setupLeader(44);
    const followed = await makePerson('+237696900008');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'x' },
    });

    await agent.get(`/api/follow-ups/${assignment.id}/conversation`);
    await agent.get(`/api/follow-ups/${assignment.id}/conversation/messages`);

    const read = await prisma.followUpConversationRead.findUnique({
      where: { personId_conversationId: { personId: leaderPerson.id, conversationId: conversation.id } },
    });
    expect(read).toBeNull();
  });

  it('requires CSRF protection', async () => {
    const { agent, person: leaderPerson, user } = await setupLeader(45);
    const followed = await makePerson('+237696900009');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    const msg = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'x' },
    });

    const res = await agent.post(`/api/follow-ups/${assignment.id}/conversation/read`).send({ messageId: msg.id });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot mark read', async () => {
    const { person: leaderPerson, user } = await setupLeader(46);
    const followed = await makePerson('+237696900010');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/follow-ups/${assignment.id}/conversation/read`).send({ messageId: 'x' });
    expect(res.status).toBe(401);
  });

  it('a stale read-mark request never moves the cursor backwards', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(47);
    const followed = await makePerson('+237696900011');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    const older = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'older' },
    });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await prisma.followUpMessage.create({
      data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'newer' },
    });

    await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: newer.id });
    await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: older.id });

    const stored = await prisma.followUpConversationRead.findUnique({
      where: { personId_conversationId: { personId: leaderPerson.id, conversationId: conversation.id } },
    });
    expect(stored!.lastReadAt.getTime()).toBe(newer.createdAt.getTime());
  });

  it('unread count excludes the reader\'s own sent messages', async () => {
    const { agent, csrf, person: leaderPerson, user } = await setupLeader(48);
    const followed = await makePerson('+237696900012');
    const assignment = await makeAssignment(leaderPerson.id, followed.id, user.id);

    await agent
      .post(`/api/follow-ups/${assignment.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'my own message' });

    const res = await agent.get(`/api/follow-ups/${assignment.id}/conversation`);
    expect(res.body.unreadCount).toBe(0);
  });
});
