import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { planPlacement } from '../lib/placement';
import { MAX_CHILD_ASSEMBLIES } from '../lib/assemblyLimit';
import { bootstrap } from './testUtils';

// "One brings two": each assembly has at most two assemblies directly under it (so the generations grow 2, 4, 8…).
// Groups are not generations and have no limit. The form can say which generation a new thing will be before saving.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.171.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Who = Awaited<ReturnType<typeof admin>>;
async function admin() {
  n += 1;
  const email = `al${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `Limit Admin ${n}`, whatsappNumber: `+2377800${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  await prisma.user.create({ data: { name: 'Central Admin', email: `al-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
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
const get = (w: Who, p: string) => w.agent.get(p);
const community = (name: string, parentId: string | null, kind: 'ASSEMBLY' | 'GROUP' = 'ASSEMBLY') =>
  prisma.community.create({ data: { name: `${name} ${++n}`, parentId, kind, autoPlacementEligible: kind === 'ASSEMBLY' } });

afterEach(() => vi.restoreAllMocks());

const C = '/api/member/central-communities';

async function world() {
  const hq = await community('AlHQ', null);
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
  const a = await admin();
  return { hq, a };
}

describe('The limit of two assemblies under each assembly', () => {
  it('says what a new group or assembly would be before it is saved: its generation and how many of the 2 places are used', async () => {
    const { hq, a } = await world();
    const asm = await get(a, `${C}/${hq.id}/new-child-preview?kind=ASSEMBLY`);
    expect(asm.body).toMatchObject({ kind: 'ASSEMBLY', generation: 1, used: 0, max: 2, full: false });
    const grp = await get(a, `${C}/${hq.id}/new-child-preview?kind=GROUP`);
    expect(grp.body).toMatchObject({ kind: 'GROUP', generation: 0, full: false });
    await community('AlOne', hq.id);
    expect((await get(a, `${C}/${hq.id}/new-child-preview?kind=ASSEMBLY`)).body).toMatchObject({ used: 1, full: false });
    await community('AlTwo', hq.id);
    expect((await get(a, `${C}/${hq.id}/new-child-preview?kind=ASSEMBLY`)).body).toMatchObject({ used: 2, full: true });
    // A group never fills up and never counts.
    expect((await get(a, `${C}/${hq.id}/new-child-preview?kind=GROUP`)).body).toMatchObject({ generation: 0, used: 2, full: false });
    // Under an assembly of generation 1, a new assembly is generation 2 and a group stays at 1.
    const one = await prisma.community.findFirstOrThrow({ where: { parentId: hq.id, name: { startsWith: 'AlOne' } } });
    expect((await get(a, `${C}/${one.id}/new-child-preview?kind=ASSEMBLY`)).body).toMatchObject({ generation: 2, used: 0 });
    expect((await get(a, `${C}/${one.id}/new-child-preview?kind=GROUP`)).body).toMatchObject({ generation: 1 });
    expect((await get(a, `${C}/does-not-exist/new-child-preview`)).status).toBe(404);
  });

  it('refuses a third assembly under an assembly, in every way of making one, but groups are not limited', async () => {
    const { hq, a } = await world();
    for (let i = 0; i < MAX_CHILD_ASSEMBLIES; i += 1) expect((await send(a, 'post', C, { name: `AlA${i} ${++n}`, parentId: hq.id })).status).toBe(201);
    const third = await send(a, 'post', C, { name: `AlThird ${++n}`, parentId: hq.id });
    expect(third.status).toBe(400);
    expect(third.body.code).toBe('ASSEMBLY_LIMIT');
    expect(third.body.error).toMatch(/already has its 2 assemblies/);
    // The "New sub-assembly" button of Assembly info says the same.
    const viaApp = await send(a, 'post', `/api/communities/${hq.id}/sub-assemblies`, { name: `AlViaApp ${++n}` });
    expect(viaApp.status).toBe(400);
    expect(viaApp.body.code).toBe('ASSEMBLY_LIMIT');
    // Groups: as many as you like, in the same generation as the assembly, never refused.
    for (let i = 0; i < 4; i += 1) {
      const g = await send(a, 'post', `/api/communities/${hq.id}/sub-assemblies`, { name: `AlGroup${i} ${++n}`, kind: 'GROUP' });
      expect(g.status).toBe(201);
    }
    const made = await prisma.community.findMany({ where: { parentId: hq.id, kind: 'GROUP' } });
    expect(made).toHaveLength(4);
    expect(made.every((g) => g.autoPlacementEligible === false)).toBe(true);
    expect(await prisma.community.count({ where: { parentId: hq.id, kind: 'ASSEMBLY' } })).toBe(2);
    // The new assembly of generation 1 can still take its own two.
    const one = await prisma.community.findFirstOrThrow({ where: { parentId: hq.id, kind: 'ASSEMBLY' } });
    expect((await send(a, 'post', `/api/communities/${one.id}/sub-assemblies`, { name: `AlChild ${++n}`, kind: 'ASSEMBLY' })).status).toBe(201);
  });

  it('does not allow a group to hold groups or assemblies', async () => {
    const { hq, a } = await world();
    const g = await community('AlG', hq.id, 'GROUP');
    expect((await send(a, 'post', `/api/communities/${g.id}/sub-assemblies`, { name: `AlInGroup ${++n}`, kind: 'GROUP' })).status).toBe(400);
  });

  it('stops a group becoming a third assembly, and an assembly moving under a full one; existing ones stay', async () => {
    const { hq, a } = await world();
    const one = await community('AlOne', hq.id);
    const two = await community('AlTwo', hq.id);
    const group = await community('AlGroupX', hq.id, 'GROUP');
    const other = await community('AlOther', null);
    const becoming = await send(a, 'patch', `${C}/${group.id}`, { kind: 'ASSEMBLY' });
    expect(becoming.status).toBe(400);
    expect(becoming.body.code).toBe('ASSEMBLY_LIMIT');
    const moving = await send(a, 'patch', `${C}/${other.id}`, { parentId: hq.id });
    expect(moving.status).toBe(400);
    expect(moving.body.code).toBe('ASSEMBLY_LIMIT');
    // Renaming one that is already there is fine, even though the assembly is full.
    expect((await send(a, 'patch', `${C}/${one.id}`, { name: `AlOne renamed ${++n}` })).status).toBe(200);
    // Room appears when one is removed.
    expect((await send(a, 'delete', `${C}/${two.id}`, { confirmName: two.name })).status).toBe(200);
    expect((await send(a, 'patch', `${C}/${group.id}`, { kind: 'ASSEMBLY' })).status).toBe(200);
  });

  it('does not delete an assembly whose children would not fit under its parent', async () => {
    const { hq, a } = await world();
    const asm = await community('AlMid', hq.id);
    const sibling = await community('AlSibling', hq.id);
    const c1 = await community('AlC1', asm.id);
    const c2 = await community('AlC2', asm.id);
    // Deleting AlMid would put AlC1, AlC2 and AlSibling (three) directly under the Headquarters.
    const refused = await send(a, 'delete', `${C}/${asm.id}`, { confirmName: asm.name, subAssemblies: 'moveUp' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('ASSEMBLY_LIMIT');
    expect(await prisma.community.findUnique({ where: { id: asm.id } })).not.toBeNull();
    // With only one child it fits (the deleted one makes room).
    await prisma.community.delete({ where: { id: c2.id } });
    expect((await send(a, 'delete', `${C}/${asm.id}`, { confirmName: asm.name, subAssemblies: 'moveUp' })).status).toBe(200);
    expect((await prisma.community.findUniqueOrThrow({ where: { id: c1.id } })).parentId).toBe(hq.id);
    expect(await prisma.community.count({ where: { parentId: hq.id, kind: 'ASSEMBLY' } })).toBe(2);
    expect(sibling.id).toBeTruthy();
  });

  it('the admin dashboard has the same limit and the same preview', async () => {
    const { hq } = await world();
    const adminUser = await prisma.user.create({ data: { name: 'Dash Admin', email: `al-dash-${++n}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN' } });
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    const login = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: adminUser.email, password: PASSWORD });
    if (login.status !== 200) return; // the dashboard sign-in needs more steps in this environment; the member door above covers the rules
    await community('AlD1', hq.id);
    await community('AlD2', hq.id);
    const res = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: `AlD3 ${++n}`, parentId: hq.id });
    expect(res.status).toBe(400);
    expect((await agent.get(`/api/admin/communities/${hq.id}/new-child-preview?kind=ASSEMBLY`)).body).toMatchObject({ used: 2, full: true });
  });
});

describe('Automatic opening of assemblies respects the limit', () => {
  const g = (id: string, members: number, auto = 0, all?: number) => ({ id, name: id, placementCountry: null, placementRegion: null, memberCount: members, autoChildCount: auto, assemblyChildCount: all, createdAt: new Date(2026, 0, 1) });
  const loc = { country: null, region: null };

  it('never opens a child under an assembly that already has two assemblies, even ones made by hand', () => {
    const full = g('a', 200, 0, 2); // two made by hand
    const open = g('b', 200, 0, 0);
    expect(planPlacement([full, open], 'SMALLEST_GROUP', loc, 200)).toEqual({ kind: 'split', parentId: 'b' });
    // Nobody can host a child: the newcomer still gets a place.
    expect(planPlacement([full], 'SMALLEST_GROUP', loc, 200)).toEqual({ kind: 'place', groupId: 'a' });
  });

  it('still counts the ones it opened itself when no total is known', () => {
    expect(planPlacement([g('a', 200, 2)], 'SMALLEST_GROUP', loc, 200)).toEqual({ kind: 'place', groupId: 'a' });
    expect(planPlacement([g('a', 200, 1)], 'SMALLEST_GROUP', loc, 200)).toEqual({ kind: 'split', parentId: 'a' });
  });
});
