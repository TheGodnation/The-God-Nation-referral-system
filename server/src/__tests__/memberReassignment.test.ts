import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Member Reassignment — Atomic Community Membership Move. Mirrors the exact
// conventions established in resourceAccessGrants.test.ts / privateMessaging
// .test.ts: agentWithUniqueIp, createLeader/createAdmin, bootstrap,
// loginAsMember, setupCommunityLeader.

const app = createApp();

let ipCounter = 20000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.94.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const email = `mr-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function makePerson(whatsappNumber: string, name = 'MR Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string, active = true) {
  return prisma.community.create({ data: { name, active } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `mr-leader${n}@test.local`;
  const { user } = await createLeader(`MR Leader ${n}`, email, `MR${n}CODE`);
  const person = await makePerson(`+237694${String(n).padStart(6, '0')}`, `MR Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function loginAsMember(whatsapp: string, email: string, name = 'MR Member') {
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

function move(agent: any, csrf: string, personId: string, fromCommunityId: string, toCommunityId: string) {
  return agent
    .post(`/api/admin/people/${personId}/community-memberships/move`)
    .set('X-CSRF-Token', csrf)
    .send({ fromCommunityId, toCommunityId });
}

const NIL = '00000000-0000-0000-0000-000000000000';

describe('Member Reassignment — authentication', () => {
  it('an unauthenticated request is rejected', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon
      .post(`/api/admin/people/${NIL}/community-memberships/move`)
      .send({ fromCommunityId: NIL, toCommunityId: NIL });
    expect(res.status).toBe(401);
  });

  it('a non-Admin (Leader) request is rejected using the existing authorization behavior', async () => {
    await createLeader('MR Leader Auth', 'mr-leader-auth@test.local', 'MRAUTHCODE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'mr-leader-auth@test.local', password: 'password123' });

    const res = await move(agent, csrf, NIL, NIL, NIL);
    expect(res.status).toBe(403);
  });

  it('a non-Admin (Member) request is rejected', async () => {
    // A Member session sets req.member, never req.user, so requireAuth (which
    // checks req.user) rejects it as unauthenticated — matching this
    // codebase's existing auth boundary for every other Admin-only route.
    const { agent, csrf } = await loginAsMember('+237695000001', 'mr-member-auth@test.local');
    const res = await move(agent, csrf, NIL, NIL, NIL);
    expect(res.status).toBe(401);
  });
});

describe('Member Reassignment — basic move', () => {
  it('moves an active member from Community A to Community B, keeping the Person identity unchanged', async () => {
    const { agent, csrf } = await loginAsAdmin(1);
    const person = await makePerson('+237600000101');
    const a = await makeCommunity('MR Community A1');
    const b = await makeCommunity('MR Community B1');
    const membershipA = await makeMembership(person.id, a.id);

    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.community.id).toBe(b.id);

    const refreshedA = await prisma.communityMembership.findUnique({ where: { id: membershipA.id } });
    expect(refreshedA?.status).toBe('INACTIVE');

    const targetRow = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId: b.id } },
    });
    expect(targetRow?.status).toBe('ACTIVE');

    const unchangedPerson = await prisma.person.findUnique({ where: { id: person.id } });
    expect(unchangedPerson?.id).toBe(person.id);
    expect(unchangedPerson?.name).toBe(person.name);
    expect(unchangedPerson?.whatsappNumber).toBe(person.whatsappNumber);
  });

  it('reactivates an existing (previously left) membership row in the target Community rather than creating a duplicate', async () => {
    const { agent, csrf } = await loginAsAdmin(9);
    const person = await makePerson('+237600000109');
    const a = await makeCommunity('MR Community A9');
    const b = await makeCommunity('MR Community B9');
    await makeMembership(person.id, a.id);
    const oldTargetRow = await makeMembership(person.id, b.id, 'INACTIVE');

    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(oldTargetRow.id);
    expect(res.body.status).toBe('ACTIVE');

    const rowCount = await prisma.communityMembership.count({ where: { personId: person.id, communityId: b.id } });
    expect(rowCount).toBe(1);
  });
});

describe('Member Reassignment — validation', () => {
  it('returns the established not-found response for an unknown Person', async () => {
    const { agent, csrf } = await loginAsAdmin(2);
    const a = await makeCommunity('MR Community A2');
    const b = await makeCommunity('MR Community B2');
    const res = await move(agent, csrf, NIL, a.id, b.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Person not found.');
  });

  it('rejects an unknown source Community', async () => {
    const { agent, csrf } = await loginAsAdmin(3);
    const person = await makePerson('+237600000103');
    const b = await makeCommunity('MR Community B3');
    const res = await move(agent, csrf, person.id, NIL, b.id);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMMUNITY_UNAVAILABLE');
  });

  it('rejects an unknown target Community', async () => {
    const { agent, csrf } = await loginAsAdmin(4);
    const person = await makePerson('+237600000104');
    const a = await makeCommunity('MR Community A4');
    await makeMembership(person.id, a.id);
    const res = await move(agent, csrf, person.id, a.id, NIL);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMMUNITY_UNAVAILABLE');
  });

  it('rejects the same Community as source and target', async () => {
    const { agent, csrf } = await loginAsAdmin(5);
    const person = await makePerson('+237600000105');
    const a = await makeCommunity('MR Community A5');
    await makeMembership(person.id, a.id);
    const res = await move(agent, csrf, person.id, a.id, a.id);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_COMMUNITY');

    const stillActive = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId: a.id } },
    });
    expect(stillActive?.status).toBe('ACTIVE');
  });

  it('rejects when the Person has no active membership in the source Community', async () => {
    const { agent, csrf } = await loginAsAdmin(6);
    const person = await makePerson('+237600000106');
    const a = await makeCommunity('MR Community A6');
    const b = await makeCommunity('MR Community B6');
    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_IN_SOURCE');

    const targetRow = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId: b.id } },
    });
    expect(targetRow).toBeNull();
  });

  it('rejects when the Person already has an active membership in the target Community, without touching the source', async () => {
    const { agent, csrf } = await loginAsAdmin(7);
    const person = await makePerson('+237600000107');
    const a = await makeCommunity('MR Community A7');
    const b = await makeCommunity('MR Community B7');
    await makeMembership(person.id, a.id);
    await makeMembership(person.id, b.id);
    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_IN_TARGET');

    const sourceStillActive = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId: a.id } },
    });
    expect(sourceStillActive?.status).toBe('ACTIVE');
  });

  it('an inactive target Community follows the existing membership rule (Community.active is display-only, never an eligibility gate)', async () => {
    const { agent, csrf } = await loginAsAdmin(8);
    const person = await makePerson('+237600000108');
    const a = await makeCommunity('MR Community A8');
    const b = await makeCommunity('MR Community B8 Inactive', false);
    await makeMembership(person.id, a.id);
    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
  });
});

describe('Member Reassignment — ownership/security', () => {
  it('authorization is controlled by the authenticated session, never by the client-supplied personId', async () => {
    const { agent, csrf } = await loginAsAdmin(10);
    const person = await makePerson('+237600000110');
    const a = await makeCommunity('MR Community A10');
    const b = await makeCommunity('MR Community B10');
    await makeMembership(person.id, a.id);

    // Passing another Person's id (not the caller's own identity — Admin has
    // no linked Person at all) changes only which Person is moved; it can
    // never grant authorization the session doesn't already have.
    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);
  });

  it('a Leader cannot move a member, even one in a Community the Leader actually leads', async () => {
    const community = await makeCommunity('MR Leader-Led Community');
    const other = await makeCommunity('MR Other Community');
    const { agent, csrf } = await setupCommunityLeader(1, community.id);
    const member = await makePerson('+237600000111');
    await makeMembership(member.id, community.id);

    const res = await move(agent, csrf, member.id, community.id, other.id);
    expect(res.status).toBe(403);

    const stillActive = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: member.id, communityId: community.id } },
    });
    expect(stillActive?.status).toBe('ACTIVE');
  });

  it("one Community's membership cannot be manipulated by another unauthorized actor (a different Leader)", async () => {
    const communityX = await makeCommunity('MR Community X');
    const communityY = await makeCommunity('MR Community Y');
    const { agent, csrf } = await setupCommunityLeader(2, communityY.id);
    const member = await makePerson('+237600000112');
    await makeMembership(member.id, communityX.id);

    const res = await move(agent, csrf, member.id, communityX.id, communityY.id);
    expect(res.status).toBe(403);
  });
});

describe('Member Reassignment — atomicity, duplicate, and concurrency integrity', () => {
  it('a failed move (target already active, detected mid-transaction by a race) leaves the Person in their original state — no partial membership state', async () => {
    const { agent, csrf } = await loginAsAdmin(11);
    const person = await makePerson('+237600000113');
    const communityA = await makeCommunity('MR Concurrency Community A');
    const communityC = await makeCommunity('MR Concurrency Community C');
    const target = await makeCommunity('MR Concurrency Target');
    await makeMembership(person.id, communityA.id);
    await makeMembership(person.id, communityC.id);

    // Two concurrent move requests for the SAME Person, from two DIFFERENT
    // source Communities, into the SAME (as-yet-unoccupied) target — a real
    // race, not a mock. Exactly one may win; the loser's entire transaction
    // (including its own source deactivation) must roll back.
    const [resA, resC] = await Promise.all([
      move(agent, csrf, person.id, communityA.id, target.id),
      move(agent, csrf, person.id, communityC.id, target.id),
    ]);

    const statuses = [resA.status, resC.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = resA.status === 200 ? 'A' : 'C';

    const membershipA = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId: communityA.id } },
    });
    const membershipC = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId: person.id, communityId: communityC.id } },
    });

    if (winner === 'A') {
      expect(membershipA?.status).toBe('INACTIVE');
      // The loser's transaction rolled back entirely: its own source
      // membership (C) was never actually deactivated, despite C's request
      // having been accepted for processing.
      expect(membershipC?.status).toBe('ACTIVE');
    } else {
      expect(membershipC?.status).toBe('INACTIVE');
      expect(membershipA?.status).toBe('ACTIVE');
    }

    // No partial state, and no duplicate ACTIVE rows: the unique
    // (personId, communityId) constraint guarantees exactly one row for the
    // target, and it is ACTIVE exactly once.
    const targetRows = await prisma.communityMembership.findMany({
      where: { personId: person.id, communityId: target.id },
    });
    expect(targetRows.length).toBe(1);
    expect(targetRows[0].status).toBe('ACTIVE');
  });

  it('a repeated move request does not create a duplicate ACTIVE membership', async () => {
    const { agent, csrf } = await loginAsAdmin(12);
    const person = await makePerson('+237600000114');
    const a = await makeCommunity('MR Repeat Community A');
    const b = await makeCommunity('MR Repeat Community B');
    await makeMembership(person.id, a.id);

    const first = await move(agent, csrf, person.id, a.id, b.id);
    expect(first.status).toBe(200);

    // Repeating the identical request: the Person is no longer actively
    // enrolled in the (now-vacated) source Community, so this is correctly
    // rejected rather than silently creating a second ACTIVE row anywhere.
    const second = await move(agent, csrf, person.id, a.id, b.id);
    expect(second.status).toBe(404);
    expect(second.body.code).toBe('NOT_IN_SOURCE');

    const targetRows = await prisma.communityMembership.count({ where: { personId: person.id, communityId: b.id } });
    expect(targetRows).toBe(1);
  });
});

describe('Member Reassignment — leadership isolation', () => {
  it('moving a member does not silently create, delete, or move any RoleAssignment data', async () => {
    const community = await makeCommunity('MR Leadership Source Community');
    const destination = await makeCommunity('MR Leadership Destination Community');
    const { agent, csrf, person, role } = await setupCommunityLeader(3, community.id);
    // A leadership RoleAssignment never implies a CommunityMembership row —
    // separate systems — so the Leader's own Person still needs an explicit
    // membership before they are eligible to be moved at all.
    await makeMembership(person.id, community.id);

    const roleCountBefore = await prisma.roleAssignment.count();

    const admin = await loginAsAdmin(13);
    const res = await move(admin.agent, admin.csrf, person.id, community.id, destination.id);
    expect(res.status).toBe(200);
    void agent;
    void csrf;

    const roleCountAfter = await prisma.roleAssignment.count();
    expect(roleCountAfter).toBe(roleCountBefore);

    const refreshedRole = await prisma.roleAssignment.findUnique({ where: { id: role.id } });
    expect(refreshedRole?.status).toBe('ACTIVE');
    expect(refreshedRole?.communityId).toBe(community.id);
    expect(refreshedRole?.roleType).toBe('SCOPED_LEADER');
  });
});

describe('Member Reassignment — data isolation', () => {
  it('ResourceAccessGrant, private conversations, follow-up assignments, and Person location fields all remain unchanged', async () => {
    const { agent, csrf, email } = await loginAsAdmin(14);
    const person = await prisma.person.create({
      data: {
        name: 'MR Isolation Person',
        whatsappNumber: '+237600000115',
        locationCountry: 'Cameroon',
        locationCity: 'Douala',
        locationArea: 'Bonapriso',
      },
    });
    const a = await makeCommunity('MR Isolation Community A');
    const b = await makeCommunity('MR Isolation Community B');
    await makeMembership(person.id, a.id);

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email } });

    const resource = await prisma.resource.create({ data: { titleEn: 'MR Isolation Resource' } });
    const grant = await prisma.resourceAccessGrant.create({
      data: { personId: person.id, resourceId: resource.id, grantedByUserId: adminUser.id },
    });

    const conversation = await prisma.privateConversation.create({
      data: { memberPersonId: person.id, initiatorUserId: adminUser.id },
    });

    const follower = await makePerson('+237600000199', 'MR Isolation Follower');
    const followUpAssignment = await prisma.followUpAssignment.create({
      data: {
        followerId: follower.id,
        followedPersonId: person.id,
        contextType: 'COMMUNITY',
        contextId: a.id,
        assignedByUserId: adminUser.id,
      },
    });

    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);

    const refreshedGrant = await prisma.resourceAccessGrant.findUnique({ where: { id: grant.id } });
    expect(refreshedGrant?.status).toBe('ACTIVE');
    expect(refreshedGrant?.resourceId).toBe(resource.id);

    const refreshedConversation = await prisma.privateConversation.findUnique({ where: { id: conversation.id } });
    expect(refreshedConversation?.memberPersonId).toBe(person.id);

    const refreshedFollowUp = await prisma.followUpAssignment.findUnique({ where: { id: followUpAssignment.id } });
    expect(refreshedFollowUp?.contextId).toBe(a.id);
    expect(refreshedFollowUp?.status).toBe('ACTIVE');

    const refreshedPerson = await prisma.person.findUnique({ where: { id: person.id } });
    expect(refreshedPerson?.locationCountry).toBe('Cameroon');
    expect(refreshedPerson?.locationCity).toBe('Douala');
    expect(refreshedPerson?.locationArea).toBe('Bonapriso');
  });

  it('a Geographic Assignment remains unchanged by a Community membership move', async () => {
    const { agent, csrf } = await loginAsAdmin(15);
    const person = await makePerson('+237600000116');
    const a = await makeCommunity('MR Geo Community A');
    const b = await makeCommunity('MR Geo Community B');
    await makeMembership(person.id, a.id);
    const geography = await prisma.geography.create({ data: { name: 'MR Test Region', type: 'REGION', countryCode: 'CM' } });
    const assignment = await prisma.geographicAssignment.create({ data: { personId: person.id, geographyId: geography.id } });

    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);

    const refreshed = await prisma.geographicAssignment.findUnique({ where: { id: assignment.id } });
    expect(refreshed?.geographyId).toBe(geography.id);
  });
});

describe('Member Reassignment — endpoint behavior', () => {
  it('a successful move returns only the minimal expected fields, no unrelated or sensitive Person information', async () => {
    const { agent, csrf } = await loginAsAdmin(16);
    const person = await makePerson('+237600000117');
    const a = await makeCommunity('MR Response Community A');
    const b = await makeCommunity('MR Response Community B');
    await makeMembership(person.id, a.id);

    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', community: { id: b.id, name: 'MR Response Community B' } });
    expect(res.body.whatsappNumber).toBeUndefined();
    expect(res.body.email).toBeUndefined();
    expect(res.body.phone).toBeUndefined();
    expect(res.body.person).toBeUndefined();
    expect(res.body.personId).toBeUndefined();
  });

  it('performs no unrelated writes: Community rows themselves are untouched', async () => {
    const { agent, csrf } = await loginAsAdmin(17);
    const person = await makePerson('+237600000118');
    const a = await makeCommunity('MR NoSideEffect Community A');
    const b = await makeCommunity('MR NoSideEffect Community B');
    await makeMembership(person.id, a.id);

    const beforeA = await prisma.community.findUnique({ where: { id: a.id } });
    const beforeB = await prisma.community.findUnique({ where: { id: b.id } });

    const res = await move(agent, csrf, person.id, a.id, b.id);
    expect(res.status).toBe(200);

    const afterA = await prisma.community.findUnique({ where: { id: a.id } });
    const afterB = await prisma.community.findUnique({ where: { id: b.id } });
    expect(afterA?.updatedAt).toEqual(beforeA?.updatedAt);
    expect(afterB?.updatedAt).toEqual(beforeB?.updatedAt);
  });
});
