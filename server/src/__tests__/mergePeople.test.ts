import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { mergePeople, describePerson } from '../lib/mergePeople';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// One person with two accounts: the duplicate is merged into the account that stays, and his leader role, the people
// he follows, who follows him, his assemblies, chats and everything else continue on the kept account.
const app = createApp();

let n = 0;
async function person(name: string, withAccount = true) {
  n += 1;
  const p = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376770${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  if (withAccount) await prisma.memberAccount.create({ data: { personId: p.id, email: `merge${n}-${Math.random().toString(36).slice(2, 8)}@test.local` } });
  return p;
}

async function world() {
  const admin = await createAdmin(`merge-admin${++n}@test.local`, 'AdminPass123!');
  const hq = await prisma.community.create({ data: { name: `Merge HQ ${n}` } });
  const groupA = await prisma.community.create({ data: { name: `Merge A ${n}`, parentId: hq.id } });
  const keep = await person('Keep Him');
  const dup = await person('Duplicate Him');
  return { admin, hq, groupA, keep, dup };
}

describe('merging two accounts of one person', () => {
  it('moves the leader role, his people, who follows him, his assemblies and his messages to the kept account, drops what both had, and removes the duplicate', async () => {
    const w = await world();
    // The duplicate is the leader: a role, a leader sign-in, and a person he follows up.
    const role = await prisma.roleAssignment.create({ data: { personId: w.dup.id, roleType: 'SCOPED_LEADER', communityId: w.groupA.id, assignedByUserId: w.admin.id } });
    const { user } = await createLeader('Dup Leader', `dupleader${n}@test.local`, `DUPL${n}`);
    await prisma.user.update({ where: { id: user.id }, data: { personId: w.dup.id } });
    const follower = await person('Learner One', false);
    const followed = await prisma.followUpAssignment.create({ data: { followerId: w.dup.id, followedPersonId: follower.id, contextType: 'COMMUNITY', contextId: w.groupA.id, assignedByUserId: w.admin.id } });
    // A leader who follows the duplicate up (as a member).
    const otherLeader = await person('Other Leader', false);
    const followsHim = await prisma.followUpAssignment.create({ data: { followerId: otherLeader.id, followedPersonId: w.dup.id, contextType: 'COMMUNITY', contextId: w.groupA.id, assignedByUserId: w.admin.id } });
    // Both are members of the same assembly (only one membership may exist), and only the duplicate belongs to another.
    await prisma.communityMembership.create({ data: { personId: w.keep.id, communityId: w.hq.id, status: 'ACTIVE' } });
    await prisma.communityMembership.create({ data: { personId: w.dup.id, communityId: w.hq.id, status: 'ACTIVE' } });
    await prisma.communityMembership.create({ data: { personId: w.dup.id, communityId: w.groupA.id, status: 'ACTIVE' } });
    // A chat message by the duplicate.
    const conversation = await prisma.conversation.create({ data: { communityId: w.groupA.id } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: w.dup.id, body: 'Hello from the old account' } });
    // The two accounts follow each other up: that link cannot exist for one person.
    await prisma.followUpAssignment.create({ data: { followerId: w.keep.id, followedPersonId: w.dup.id, contextType: 'COMMUNITY', contextId: w.hq.id, assignedByUserId: w.admin.id } });
    // Friends of the duplicate, and a friendship between the two accounts.
    const friend = await person('Friend', false);
    await prisma.friendship.create({ data: { requesterPersonId: w.dup.id, addresseePersonId: friend.id, status: 'ACCEPTED' } as any });
    await prisma.friendship.create({ data: { requesterPersonId: w.keep.id, addresseePersonId: w.dup.id, status: 'ACCEPTED' } as any });

    // The preview changes nothing and says what would move.
    const preview = await mergePeople(w.keep.id, w.dup.id, { dryRun: true });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.dryRun).toBe(true);
    expect(preview.report.summary).toMatchObject({ roles: 1, peopleHeFollows: 1, leadersFollowingHim: 1, messages: 1 });
    expect(preview.report.summary.dropped).toBeGreaterThanOrEqual(2); // the shared assembly membership, the duplicate's sign-in
    expect(preview.report.summary.betweenThem).toBeGreaterThanOrEqual(2); // the follow-up and the friendship between the two accounts
    expect(await prisma.person.count({ where: { id: w.dup.id } })).toBe(1);
    expect((await prisma.roleAssignment.findUniqueOrThrow({ where: { id: role.id } })).personId).toBe(w.dup.id);

    // The real merge.
    const done = await mergePeople(w.keep.id, w.dup.id);
    expect(done.ok).toBe(true);
    expect(await prisma.person.count({ where: { id: w.dup.id } })).toBe(0);
    // His role, sign-in, people, followers, assemblies and messages continue on the kept account.
    expect((await prisma.roleAssignment.findUniqueOrThrow({ where: { id: role.id } })).personId).toBe(w.keep.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).personId).toBe(w.keep.id);
    expect((await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: followed.id } })).followerId).toBe(w.keep.id);
    expect((await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: followsHim.id } })).followedPersonId).toBe(w.keep.id);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).senderPersonId).toBe(w.keep.id);
    const memberships = await prisma.communityMembership.findMany({ where: { personId: w.keep.id } });
    expect(memberships.map((m) => m.communityId).sort()).toEqual([w.hq.id, w.groupA.id].sort());
    // The friend stays his friend; nothing links him to himself.
    expect(await prisma.friendship.count({ where: { requesterPersonId: w.keep.id, addresseePersonId: friend.id } })).toBe(1);
    expect(await prisma.friendship.count({ where: { requesterPersonId: w.keep.id, addresseePersonId: w.keep.id } })).toBe(0);
    expect(await prisma.followUpAssignment.count({ where: { followerId: w.keep.id, followedPersonId: w.keep.id } })).toBe(0);
    // He keeps signing in with the kept account's email.
    expect(await prisma.memberAccount.count({ where: { personId: w.keep.id } })).toBe(1);
  });

  it('moves the sign-in too when only the duplicate has an account, so he can still sign in', async () => {
    const w = await world();
    await prisma.memberAccount.deleteMany({ where: { personId: w.keep.id } });
    const dupAccount = await prisma.memberAccount.findFirstOrThrow({ where: { personId: w.dup.id } });
    expect((await mergePeople(w.keep.id, w.dup.id)).ok).toBe(true);
    expect((await prisma.memberAccount.findUniqueOrThrow({ where: { id: dupAccount.id } })).personId).toBe(w.keep.id);
  });

  it('refuses the central admin, the same account twice, an unknown account, and two accounts that both have a leader sign-in', async () => {
    const w = await world();
    const adminPerson = await person('Admin Person', false);
    await prisma.user.update({ where: { id: w.admin.id }, data: { personId: adminPerson.id } });
    expect(await mergePeople(w.keep.id, adminPerson.id)).toMatchObject({ ok: false });
    expect(await mergePeople(adminPerson.id, w.dup.id)).toMatchObject({ ok: false });
    expect(await mergePeople(w.keep.id, w.keep.id)).toMatchObject({ ok: false });
    expect(await mergePeople(w.keep.id, 'nobody')).toMatchObject({ ok: false });
    const a = await createLeader('Lead One', `leadone${n}@test.local`, `LONE${n}`);
    const b = await createLeader('Lead Two', `leadtwo${n}@test.local`, `LTWO${n}`);
    await prisma.user.update({ where: { id: a.user.id }, data: { personId: w.keep.id } });
    await prisma.user.update({ where: { id: b.user.id }, data: { personId: w.dup.id } });
    expect(await mergePeople(w.keep.id, w.dup.id)).toMatchObject({ ok: false });
    expect(await prisma.person.count({ where: { id: w.dup.id } })).toBe(1);
  });

  it('describes an account so the right one is kept', async () => {
    const w = await world();
    await prisma.roleAssignment.create({ data: { personId: w.dup.id, roleType: 'SCOPED_LEADER', communityId: w.groupA.id, assignedByUserId: w.admin.id } });
    const info = await describePerson(w.dup.id);
    expect(info).toMatchObject({ id: w.dup.id, leaderOf: [w.groupA.name] });
    expect(info?.signInEmail).toContain('@test.local');
  });
});

describe('merging from the admin dashboard', () => {
  it('previews first, then merges, and records it; only the admin can', async () => {
    const w = await world();
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent as any);
    expect((await agent.post('/api/admin/cells/merge-people').set('X-CSRF-Token', csrf).send({ keepPersonId: w.keep.id, mergePersonId: w.dup.id })).status).toBe(401);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: w.admin.email, password: 'AdminPass123!' });
    const preview = await agent.post('/api/admin/cells/merge-people').set('X-CSRF-Token', csrf).send({ keepPersonId: w.keep.id, mergePersonId: w.dup.id, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.dryRun).toBe(true);
    expect(await prisma.person.count({ where: { id: w.dup.id } })).toBe(1);
    const done = await agent.post('/api/admin/cells/merge-people').set('X-CSRF-Token', csrf).send({ keepPersonId: w.keep.id, mergePersonId: w.dup.id });
    expect(done.status).toBe(200);
    expect(done.body.dryRun).toBe(false);
    expect(await prisma.person.count({ where: { id: w.dup.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'PEOPLE_MERGED', targetId: w.keep.id } })).toBe(1);
    const bad = await agent.post('/api/admin/cells/merge-people').set('X-CSRF-Token', csrf).send({ keepPersonId: w.keep.id, mergePersonId: w.keep.id });
    expect(bad.status).toBe(400);
    const info = await agent.get(`/api/admin/cells/merge-people/describe?personId=${w.keep.id}`);
    expect(info.status).toBe(200);
  });
});
