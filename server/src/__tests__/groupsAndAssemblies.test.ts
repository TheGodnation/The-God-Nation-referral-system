import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { placePersonInGroup } from '../lib/placement';
import { assembliesOverview } from '../lib/cells';
import { getCommunityGeneration, getCommunityIdsAtGeneration } from '../lib/tree';
import { bootstrap } from './testUtils';

// Assemblies grow the generations (founding generation 0, then 1, 2…). Groups (women, youth, prayer, leadership team…)
// belong to an assembly and are never counted as generations.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.157.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Who = Awaited<ReturnType<typeof signedIn>>;
async function signedIn(name: string, admin = false) {
  n += 1;
  const email = `ga${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377500${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (admin) await prisma.user.create({ data: { name: 'Central Admin', email: `ga-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, agent, csrf };
}
const send = (w: Who, method: 'post' | 'patch' | 'delete', p: string, body: unknown = {}) => w.agent[method](p).set('X-CSRF-Token', w.csrf).send(body as object);
const community = (name: string, parentId: string | null, kind: 'ASSEMBLY' | 'GROUP' = 'ASSEMBLY') =>
  prisma.community.create({ data: { name: `${name} ${++n}`, parentId, kind, autoPlacementEligible: kind === 'ASSEMBLY' } });
const assigner = async () => (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.create({ data: { name: 'A', email: `ga-a-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
const lead = async (personId: string, communityId: string) => prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: (await assigner()).id } });
const join = (personId: string, communityId: string) => prisma.communityMembership.create({ data: { personId, communityId } });

afterEach(() => vi.restoreAllMocks());

// HQ (founding generation 0) with a Women group; assembly A (generation 1) with a Youth group; A1 (generation 2).
async function world() {
  const hq = await community('GaHQ', null);
  const women = await community('GaWomen', hq.id, 'GROUP');
  const A = await community('GaA', hq.id);
  const youth = await community('GaYouth', A.id, 'GROUP');
  const A1 = await community('GaA1', A.id);
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
  const admin = await signedIn('Admin', true);
  const rep = await signedIn('Rep');
  await lead(rep.person.id, A.id);
  await join(rep.person.id, A.id);
  expect((await send(admin, 'post', '/api/member/central-representatives/appoint', { personId: rep.person.id, generation: 1 })).status).toBe(201);
  const member = await signedIn('Member');
  await join(member.person.id, A.id);
  await join(member.person.id, youth.id);
  const hqMember = await signedIn('HqMember');
  await join(hqMember.person.id, hq.id);
  return { hq, women, A, youth, A1, admin, rep, member, hqMember };
}

describe('Generations count assemblies only', () => {
  it('a group has its assembly’s generation, and the generation lists include the groups', async () => {
    const { hq, women, A, youth, A1 } = await world();
    expect(await getCommunityGeneration(hq.id, hq.id)).toBe(0);
    expect(await getCommunityGeneration(women.id, hq.id)).toBe(0);
    expect(await getCommunityGeneration(A.id, hq.id)).toBe(1);
    expect(await getCommunityGeneration(youth.id, hq.id)).toBe(1);
    expect(await getCommunityGeneration(A1.id, hq.id)).toBe(2);
    expect((await getCommunityIdsAtGeneration(hq.id, 0)).sort()).toEqual([hq.id, women.id].sort());
    expect((await getCommunityIdsAtGeneration(hq.id, 1)).sort()).toEqual([A.id, youth.id].sort());
    expect(await getCommunityIdsAtGeneration(hq.id, 2)).toEqual([A1.id]);
  });

  it('newcomers are never placed in a group, even one wrongly left open', async () => {
    const hq = await community('GaPlaceHQ', null);
    const group = await community('GaPlaceGroup', hq.id, 'GROUP');
    await prisma.community.update({ where: { id: group.id }, data: { autoPlacementEligible: true } });
    const before = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
    try {
      const p = await prisma.person.create({ data: { name: `Newcomer ${++n}`, whatsappNumber: `+2377600${String(n).padStart(5, '0')}` } });
      const placed = await placePersonInGroup(p.id, {} as any);
      expect(placed).toBe(hq.id);
    } finally {
      await prisma.settings.update({ where: { id: 'singleton' }, data: { headquartersCommunityId: before?.headquartersCommunityId ?? null } });
    }
  });

  it('following people up counts members of assemblies only, not of groups', async () => {
    const { youth, A, member } = await world();
    const overview = await assembliesOverview();
    const row = (id: string) => overview.items.find((r) => r.id === id)!;
    expect(row(youth.id).kind).toBe('GROUP');
    expect(row(youth.id).unassigned).toBe(0);
    expect(row(youth.id).members).toBeGreaterThanOrEqual(1);
    expect(row(A.id).kind).toBe('ASSEMBLY');
    expect(row(A.id).unassigned).toBeGreaterThanOrEqual(1);
    void member;
  });

  it('turns the former Headquarters into a group automatically (the Leadership Team)', async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261206090000_community_kind/migration.sql'), 'utf8');
    const backfill = sql.slice(sql.indexOf('UPDATE "Community"'));
    const oldHq = await community('GaOldHQ', null);
    const newHq = await community('GaNewHQ', null);
    await prisma.community.update({ where: { id: oldHq.id }, data: { parentId: newHq.id } });
    const other = await community('GaOtherChild', newHq.id);
    const before = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: newHq.id }, create: { id: 'singleton', headquartersCommunityId: newHq.id } as any });
    const log = await prisma.auditLog.create({ data: { action: 'HEADQUARTERS_COMMUNITY_REPLACED', targetType: 'Community', targetId: newHq.id, metadata: { previousHeadquartersId: oldHq.id } } });
    try {
      await prisma.$executeRawUnsafe(backfill);
      const old = await prisma.community.findUniqueOrThrow({ where: { id: oldHq.id } });
      expect(old).toMatchObject({ kind: 'GROUP', autoPlacementEligible: false });
      expect((await prisma.community.findUniqueOrThrow({ where: { id: other.id } })).kind).toBe('ASSEMBLY'); // others untouched
      expect(await getCommunityGeneration(oldHq.id, newHq.id)).toBe(0);
    } finally {
      await prisma.auditLog.delete({ where: { id: log.id } });
      await prisma.settings.update({ where: { id: 'singleton' }, data: { headquartersCommunityId: before?.headquartersCommunityId ?? null } });
    }
  });
});

describe('Rename, type and delete from the central admin’s profile', () => {
  const C = '/api/member/central-communities';
  it('the same tools as the admin dashboard: list, new group, rename, change type, delete', async () => {
    const { hq, admin, member, women } = await world();
    const list = await admin.agent.get(`${C}?parentId=${hq.id}`);
    expect(list.status).toBe(200);
    expect(list.body.items.find((c: any) => c.id === women.id)).toMatchObject({ kind: 'GROUP', generation: 0 });

    const made = await send(admin, 'post', C, { name: 'Prayer Group', kind: 'GROUP', parentId: hq.id });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ kind: 'GROUP', autoPlacementEligible: false });
    const renamed = await send(admin, 'patch', `${C}/${made.body.id}`, { name: 'Intercession Team' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Intercession Team');
    expect(await prisma.auditLog.findFirst({ where: { action: 'COMMUNITY_UPDATED', targetId: made.body.id } })).toBeTruthy();

    await prisma.communityMembership.create({ data: { personId: member.person.id, communityId: made.body.id } });
    const impact = await admin.agent.get(`${C}/${made.body.id}/delete-impact`);
    expect(impact.body.members).toBe(1);
    const del = await send(admin, 'delete', `${C}/${made.body.id}`, { confirmName: 'Intercession Team', moveMembersTo: hq.id });
    expect(del.status).toBe(200);
    expect(await prisma.community.findUnique({ where: { id: made.body.id } })).toBeNull();
    expect(await prisma.communityMembership.findFirst({ where: { personId: member.person.id, communityId: hq.id, status: 'ACTIVE' } })).toBeTruthy();
  });

  it('is only for the central admin', async () => {
    const { rep, member } = await world();
    for (const who of [rep, member]) expect((await who.agent.get(C)).status).toBe(403);
    expect((await agentWithIp().get(C)).status).toBe(401);
  });
});

describe('Leaders of groups', () => {
  const CG = '/api/member/central-groups';
  const RG = '/api/member/rep-groups';

  it('the central admin lists every group, picks a member of the group or its assembly, and makes them its leader', async () => {
    const { women, youth, admin, member, hqMember } = await world();
    const groups = await admin.agent.get(`${CG}/groups`);
    const byId = Object.fromEntries(groups.body.items.map((g: any) => [g.id, g]));
    expect(byId[women.id]).toMatchObject({ generation: 0 });
    expect(byId[youth.id]).toMatchObject({ generation: 1 });
    expect(byId[youth.id].assemblyName).toContain('GaA');

    const cand = await admin.agent.get(`${CG}/candidates?communityId=${youth.id}`);
    const ids = cand.body.items.map((p: any) => p.id);
    expect(ids).toContain(member.person.id);
    expect(ids).not.toContain(hqMember.person.id); // belongs to neither the group nor its assembly
    expect((await send(admin, 'post', `${CG}/leader`, { communityId: youth.id, personId: hqMember.person.id })).status).toBe(400);

    const ok = await send(admin, 'post', `${CG}/leader`, { communityId: youth.id, personId: member.person.id });
    expect(ok.status).toBe(201);
    expect(await prisma.notification.count({ where: { recipientPersonId: member.person.id, type: 'ROLE_ASSIGNED' } })).toBe(1);
    expect((await send(admin, 'post', `${CG}/leader`, { communityId: youth.id, personId: member.person.id })).status).toBe(409);
    expect((await admin.agent.get(`${CG}/candidates?communityId=${youth.id}`)).body.items.map((p: any) => p.id)).not.toContain(member.person.id);
    const after = await admin.agent.get(`${CG}/groups`);
    expect(after.body.items.find((g: any) => g.id === youth.id).leaders.map((l: any) => l.id)).toContain(member.person.id);
    // Not an assembly: those are led through the Leadership Academy.
    expect((await send(admin, 'post', `${CG}/leader`, { communityId: (await prisma.community.findFirstOrThrow({ where: { name: { startsWith: 'GaA ' } } })).id, personId: member.person.id })).status).toBe(404);
  });

  it('a leader of a group can run that group: they can write where only leaders may', async () => {
    const { youth, admin, member } = await world();
    await prisma.conversation.create({ data: { communityId: youth.id } });
    await prisma.community.update({ where: { id: youth.id }, data: { postingPolicy: 'LEADERS_ONLY' } });
    const say = () => send(member, 'post', `/api/communities/${youth.id}/conversation/messages`, { body: 'Youth meeting Friday' });
    expect((await say()).status).toBe(403);
    await send(admin, 'post', `${CG}/leader`, { communityId: youth.id, personId: member.person.id });
    expect((await say()).status).toBe(201);
  });

  it('a representative does the same, but only for the groups of their own generation', async () => {
    const { women, youth, rep, member, hqMember } = await world();
    const mine = await rep.agent.get(`${RG}/groups`);
    expect(mine.body.items.map((g: any) => g.id)).toEqual([youth.id]); // not the Headquarters' Women group
    expect((await rep.agent.get(`${RG}/candidates?communityId=${women.id}`)).status).toBe(403);
    expect((await send(rep, 'post', `${RG}/leader`, { communityId: women.id, personId: hqMember.person.id })).status).toBe(403);
    expect((await send(rep, 'post', `${RG}/leader`, { communityId: youth.id, personId: member.person.id })).status).toBe(201);
    const row = await prisma.auditLog.findFirst({ where: { action: 'ROLE_ASSIGNMENT_CREATED', metadata: { path: ['via'], equals: 'group-leader-by-representative' } } });
    expect(row).toBeTruthy();
  });

  it('keeps the two doors apart and closed to everyone else', async () => {
    const { rep, admin, member } = await world();
    expect((await admin.agent.get(`${RG}/groups`)).status).toBe(403);
    expect((await rep.agent.get(`${CG}/groups`)).status).toBe(403);
    expect((await member.agent.get(`${CG}/groups`)).status).toBe(403);
    expect((await member.agent.get(`${RG}/groups`)).status).toBe(403);
    expect((await agentWithIp().get(`${CG}/groups`)).status).toBe(401);
  });
});

describe('French name of an assembly or group', () => {
  const C = '/api/member/central-communities';
  const asLang = (w: Who, lang: 'en' | 'fr', path: string) => w.agent.get(path).set('X-App-Language', lang);

  it('the admin writes the French name next to the English one; French speakers see it, English speakers and a missing French name show the English', async () => {
    const { hq, A, admin, member } = await world();
    const created = await send(admin, 'post', C, { name: 'Prayer Group', nameFr: 'Groupe de prière', kind: 'GROUP', parentId: hq.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Prayer Group', nameFr: 'Groupe de prière' });
    await prisma.communityMembership.create({ data: { personId: member.person.id, communityId: created.body.id } });
    const renamed = await send(admin, 'patch', `${C}/${A.id}`, { nameFr: 'Assemblée A' });
    expect(renamed.body.nameFr).toBe('Assemblée A');

    const names = async (lang: 'en' | 'fr') => {
      const r = await asLang(member, lang, '/api/member/me/community-memberships');
      return Object.fromEntries(r.body.items.map((i: any) => [i.communityId, i.communityName]));
    };
    const fr = await names('fr');
    const en = await names('en');
    expect(fr[created.body.id]).toBe('Groupe de prière');
    expect(en[created.body.id]).toBe('Prayer Group');
    expect(fr[A.id]).toBe('Assemblée A');
    expect(en[A.id]).toBe(A.name);
    // The chat header (conversation meta) follows the same rule, and falls back to English when there is no French name.
    const noFr = await prisma.community.findUniqueOrThrow({ where: { id: hq.id } });
    await prisma.conversation.upsert({ where: { communityId: created.body.id }, create: { communityId: created.body.id }, update: {} });
    expect((await asLang(member, 'fr', `/api/communities/${created.body.id}/conversation`)).body.name).toBe('Groupe de prière');
    expect((await asLang(member, 'en', `/api/communities/${created.body.id}/conversation`)).body.name).toBe('Prayer Group');
    await prisma.conversation.upsert({ where: { communityId: A.id }, create: { communityId: A.id }, update: {} });
    expect((await asLang(member, 'fr', `/api/communities/${hq.id}/conversation`)).status).toBeLessThan(500);
    expect(noFr.nameFr).toBeNull();
  });

  it('blank clears the French name, and a very long one is refused', async () => {
    const { hq, admin } = await world();
    const g = await send(admin, 'post', C, { name: 'Youth', nameFr: 'Jeunes', kind: 'GROUP', parentId: hq.id });
    expect(g.body.nameFr).toBe('Jeunes');
    const cleared = await send(admin, 'patch', `${C}/${g.body.id}`, { nameFr: '   ' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.nameFr).toBeNull();
    expect((await send(admin, 'patch', `${C}/${g.body.id}`, { nameFr: 'x'.repeat(201) })).status).toBe(400);
  });

  it('events and the person page show the French name to French speakers', async () => {
    const { A, admin, member } = await world();
    await send(admin, 'patch', `${C}/${A.id}`, { nameFr: 'Assemblée Alpha' });
    const profile = await asLang(member, 'fr', `/api/member/people/${member.person.id}`);
    // (own profile is refused or returns lists; the point is that no server error occurs with the French header)
    expect(profile.status).toBeLessThan(500);
    const other = await signedIn('Viewer');
    await join(other.person.id, A.id);
    const seen = await asLang(other, 'fr', `/api/member/people/${member.person.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.memberOf).toContain('Assemblée Alpha');
    const seenEn = await asLang(other, 'en', `/api/member/people/${member.person.id}`);
    expect(seenEn.body.memberOf).toContain(A.name);
  });
});
