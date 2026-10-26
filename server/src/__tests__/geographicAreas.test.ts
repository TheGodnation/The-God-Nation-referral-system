import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Phase 6 — Geographical Leadership Directory: the Admin-managed
// GeographicArea tree (Country -> Region -> Division -> Subdivision ->
// Quarter), AreaLeadershipAssignment ("leader of this exact Area"), the
// Member-facing directory browse, and AreaRepresentationRequest
// (submit -> Admin decide -> approval itself creates the assignment).
// Deliberately a brand-new, separate concept from the retired Geography
// model — see the schema comment above GeographicArea.
const app = createApp();

let ipCounter = 40000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.123.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
async function member(name: string): Promise<Member> {
  n += 1;
  const whatsapp = `+2376706${String(n).padStart(5, '0')}`;
  const email = `geoarea${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
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

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

const send = (agent: Agent, csrf: string, method: 'post' | 'patch' | 'delete', path: string, body: Record<string, unknown> = {}) =>
  agent[method](path).set('X-CSRF-Token', csrf).send(body);

// Builds Cameroon -> Littoral -> Wouri -> Douala V -> Bepanda, matching the
// user's own example exactly, via the real admin API (never seeded
// directly) so the level-derivation logic itself is exercised.
async function buildCameroonPath(adminAgent: Agent, adminCsrf: string) {
  const country = await send(adminAgent, adminCsrf, 'post', '/api/admin/geographic-areas', { parentId: null, name: 'Cameroon' });
  const region = await send(adminAgent, adminCsrf, 'post', '/api/admin/geographic-areas', { parentId: country.body.id, name: 'Littoral' });
  const division = await send(adminAgent, adminCsrf, 'post', '/api/admin/geographic-areas', { parentId: region.body.id, name: 'Wouri' });
  const subdivision = await send(adminAgent, adminCsrf, 'post', '/api/admin/geographic-areas', { parentId: division.body.id, name: 'Douala V' });
  const quarter = await send(adminAgent, adminCsrf, 'post', '/api/admin/geographic-areas', { parentId: subdivision.body.id, name: 'Bepanda' });
  return { country: country.body, region: region.body, division: division.body, subdivision: subdivision.body, quarter: quarter.body };
}

describe('Geographic Areas — Admin tree management', () => {
  it('derives the level from the parent at each step, and the title matches the user\'s own examples', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-tree@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);

    expect(path.country).toMatchObject({ name: 'Cameroon', level: 'NATIONAL', country: 'Cameroon', title: 'National Representative of The God Nation' });
    expect(path.region).toMatchObject({ name: 'Littoral', level: 'REGION', country: 'Cameroon', title: 'Regional Leader' });
    expect(path.division).toMatchObject({ name: 'Wouri', level: 'DIVISION', country: 'Cameroon', title: 'Divisional Leader' });
    expect(path.subdivision).toMatchObject({ name: 'Douala V', level: 'SUBDIVISION', country: 'Cameroon', title: 'Subdivisional Leader' });
    expect(path.quarter).toMatchObject({ name: 'Bepanda', level: 'QUARTER', country: 'Cameroon', title: 'Quarter Representative' });
  });

  it('rejects adding a sub-area under a Quarter (the deepest level)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-deepest@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const res = await send(adminAgent, csrf, 'post', '/api/admin/geographic-areas', { parentId: path.quarter.id, name: 'Too Deep' });
    expect(res.status).toBe(400);
  });

  it('browsing by parentId returns exactly that node\'s children; omitting parentId returns NATIONAL roots', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-browse@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);

    const roots = await adminAgent.get('/api/admin/geographic-areas');
    expect(roots.body.items.map((i: any) => i.id)).toContain(path.country.id);

    const children = await adminAgent.get(`/api/admin/geographic-areas?parentId=${path.country.id}`);
    expect(children.body.items.map((i: any) => i.id)).toEqual([path.region.id]);
  });

  it('the detail endpoint reports the title, full ancestor path, and children of one area', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-detail@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);

    const detail = await adminAgent.get(`/api/admin/geographic-areas/${path.division.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ name: 'Wouri', level: 'DIVISION', title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon' });
    expect(detail.body.ancestors.map((a: any) => a.name)).toEqual(['Cameroon', 'Littoral']);
    expect(detail.body.children.map((c: any) => c.name)).toEqual(['Douala V']);

    expect((await adminAgent.get('/api/admin/geographic-areas/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('renames an area without changing its level', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-rename@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const renamed = await send(adminAgent, csrf, 'patch', `/api/admin/geographic-areas/${path.region.id}`, { name: 'Littoral Region' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Littoral Region', level: 'REGION' });
  });

  it('refuses to delete an area that still has sub-areas', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-delete-blocked@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const res = await send(adminAgent, csrf, 'delete', `/api/admin/geographic-areas/${path.region.id}`);
    expect(res.status).toBe(409);
  });

  it('deletes a leaf area with no current leader', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-delete-ok@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const res = await send(adminAgent, csrf, 'delete', `/api/admin/geographic-areas/${path.quarter.id}`);
    expect(res.status).toBe(200);
    expect(await prisma.geographicArea.findUnique({ where: { id: path.quarter.id } })).toBeNull();
  });

  it('a non-Admin cannot create, rename, or delete an area', async () => {
    const { user } = await createLeader('Geo Leader', 'leader-geo-area@test.local', 'GEOL1CODE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-geo-area@test.local', password: 'password123' });
    const res = await send(agent, csrf, 'post', '/api/admin/geographic-areas', { parentId: null, name: 'Nigeria' });
    expect(res.status).toBe(403);
    void user;
  });
});

describe('Geographic Areas — Admin leadership assignments', () => {
  it('assigns a leader to an area, notifies them with the correct title and full path, and is visible on their profile', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-assign@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const leader = await member('Area Leader One');

    const assigned = await send(adminAgent, csrf, 'post', '/api/admin/area-leadership-assignments', { personId: leader.id, areaId: path.division.id });
    expect(assigned.status).toBe(201);
    expect(assigned.body.status).toBe('ACTIVE');

    const note = await prisma.notification.findFirst({ where: { recipientPersonId: leader.id, type: 'AREA_LEADERSHIP_ASSIGNED' } });
    expect(note).not.toBeNull();
    expect((note!.metadata as any).areaTitle).toBe('Divisional Leader');
    expect((note!.metadata as any).areaPath).toBe('Wouri, Littoral, Cameroon');

    const profile = await leader.agent.get(`/api/member/people/${leader.id}`);
    expect(profile.body.areaLeaderOf).toEqual([{ title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon' }]);
  });

  it('rejects assigning the same Person to the same Area twice while the first is still ACTIVE', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-dup@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const leader = await member('Area Leader Two');

    await send(adminAgent, csrf, 'post', '/api/admin/area-leadership-assignments', { personId: leader.id, areaId: path.region.id });
    const second = await send(adminAgent, csrf, 'post', '/api/admin/area-leadership-assignments', { personId: leader.id, areaId: path.region.id });
    expect(second.status).toBe(409);
  });

  it('ending an assignment clears it from the area\'s directory listing, marking the area vacant again', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-end@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const leader = await member('Area Leader Three');
    const assigned = await send(adminAgent, csrf, 'post', '/api/admin/area-leadership-assignments', { personId: leader.id, areaId: path.region.id });

    const before = await leader.agent.get(`/api/member/leadership-directory/areas?country=Cameroon&level=REGION`);
    expect(before.body.items.find((i: any) => i.id === path.region.id).leaders).toEqual([{ personId: leader.id, name: 'Area Leader Three', photoUrl: null, title: 'Regional Leader' }]);

    const ended = await send(adminAgent, csrf, 'patch', `/api/admin/area-leadership-assignments/${assigned.body.id}/end`);
    expect(ended.status).toBe(200);

    const after = await leader.agent.get(`/api/member/leadership-directory/areas?country=Cameroon&level=REGION`);
    expect(after.body.items.find((i: any) => i.id === path.region.id).leaders).toEqual([]);
  });

  it('a non-Admin cannot create or end an area leadership assignment', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-assign-setup@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const leader = await member('Area Leader Four');

    await createLeader('Other Leader', 'leader-geo-assign@test.local', 'GEOL2CODE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-geo-assign@test.local', password: 'password123' });
    const res = await send(agent, csrf, 'post', '/api/admin/area-leadership-assignments', { personId: leader.id, areaId: path.region.id });
    expect(res.status).toBe(403);
  });
});

describe('Geographic Areas — Member directory browsing', () => {
  it('lists every country with a NATIONAL root', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-countries@test.local');
    await buildCameroonPath(adminAgent, csrf);
    const m = await member('Country Browser');
    const res = await m.agent.get('/api/member/geographic-areas/countries');
    expect(res.body.items.map((i: any) => i.name)).toContain('Cameroon');
  });

  it('the flattened directory shows the correct title and full path for every rank, exactly matching the user\'s own examples', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-directory@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const m = await member('Directory Browser');

    const res = await m.agent.get('/api/member/leadership-directory/areas?country=Cameroon');
    expect(res.status).toBe(200);
    const byId = (id: string) => res.body.items.find((i: any) => i.id === id);

    expect(byId(path.quarter.id)).toMatchObject({ title: 'Quarter Representative', path: 'Bepanda, Douala V, Wouri, Littoral, Cameroon' });
    expect(byId(path.subdivision.id)).toMatchObject({ title: 'Subdivisional Leader', path: 'Douala V, Wouri, Littoral, Cameroon' });
    expect(byId(path.division.id)).toMatchObject({ title: 'Divisional Leader', path: 'Wouri, Littoral, Cameroon' });
    expect(byId(path.region.id)).toMatchObject({ title: 'Regional Leader', path: 'Littoral, Cameroon' });
    expect(byId(path.country.id)).toMatchObject({ title: 'National Representative of The God Nation', path: 'Cameroon' });
  });

  it('an area with no assignment clearly shows an empty leaders list (vacant)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin('admin-geo-vacant@test.local');
    const path = await buildCameroonPath(adminAgent, csrf);
    const m = await member('Vacancy Browser');
    const res = await m.agent.get(`/api/member/leadership-directory/areas?country=Cameroon&level=QUARTER`);
    expect(res.body.items.find((i: any) => i.id === path.quarter.id).leaders).toEqual([]);
  });

  it('requires authentication', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/member/geographic-areas')).status).toBe(401);
    expect((await anon.get('/api/member/leadership-directory/areas?country=Cameroon')).status).toBe(401);
  });
});

describe('Area Representation Requests — member submission', () => {
  it('submits a request targeting a real area; it grants nothing by itself', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-setup@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester One');

    const res = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id, note: 'I already lead our Bepanda cell group.' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');

    expect(await prisma.areaLeadershipAssignment.count({ where: { personId: m.id } })).toBe(0);

    const mine = await m.agent.get('/api/member/area-representation-requests/mine');
    expect(mine.body.items).toHaveLength(1);
  });

  it('rejects a second pending request while one is already pending', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-dup@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester Two');

    const first = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });
    expect(first.status).toBe(201);
    const second = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.region.id });
    expect(second.status).toBe(409);
  });

  it('lets a member withdraw their own pending request', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-withdraw@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester Three');

    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });
    const withdrawn = await send(m.agent, m.csrf, 'delete', `/api/member/area-representation-requests/${created.body.id}`);
    expect(withdrawn.status).toBe(200);
    expect(await prisma.areaRepresentationRequest.count({ where: { personId: m.id } })).toBe(0);
  });
});

describe('Area Representation Requests — Admin review', () => {
  it('approving a request creates the AreaLeadershipAssignment itself and notifies the member', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-approve@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester Four');
    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });

    const approve = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/approve`, { decisionNote: 'Confirmed locally.' });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');
    expect(approve.body.areaLeadershipAssignmentId).toBeTruthy();

    const assignment = await prisma.areaLeadershipAssignment.findUnique({ where: { id: approve.body.areaLeadershipAssignmentId } });
    expect(assignment).toMatchObject({ personId: m.id, areaId: path.quarter.id, status: 'ACTIVE' });

    const note = await prisma.notification.findFirst({ where: { recipientPersonId: m.id, type: 'AREA_LEADERSHIP_ASSIGNED' } });
    expect(note).not.toBeNull();
  });

  it('declining a request creates no assignment and notifies the member', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-decline@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester Five');
    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });

    const decline = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/decline`, { decisionNote: 'Not yet.' });
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe('DECLINED');
    expect(await prisma.areaLeadershipAssignment.count({ where: { personId: m.id } })).toBe(0);

    const note = await prisma.notification.findFirst({ where: { recipientPersonId: m.id, type: 'AREA_REPRESENTATION_REQUEST_DECLINED' } });
    expect(note).not.toBeNull();
  });

  it('a second decision on an already-decided request is rejected', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-twice@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester Six');
    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });

    await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/approve`);
    const second = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/decline`);
    expect(second.status).toBe(409);
  });

  it('approving twice for two different people on the same area succeeds (co-leaders are allowed)', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-coleaders@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m1 = await member('Area Requester Seven');
    const m2 = await member('Area Requester Eight');
    const r1 = await send(m1.agent, m1.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });
    const r2 = await send(m2.agent, m2.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });

    const a1 = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${r1.body.id}/approve`);
    const a2 = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${r2.body.id}/approve`);
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(await prisma.areaLeadershipAssignment.count({ where: { areaId: path.quarter.id, status: 'ACTIVE' } })).toBe(2);
  });

  it('a non-Admin cannot approve or decline', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-req-nonadmin-setup@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Area Requester Nine');
    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id });

    await createLeader('Req Review Leader', 'leader-geo-req@test.local', 'GEOL3CODE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-geo-req@test.local', password: 'password123' });
    const res = await send(agent, csrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/approve`);
    expect(res.status).toBe(403);
  });
});

describe('Leadership Directory — position titles, National Team, places not on the list', () => {
  it('shows the position the admin named, else the usual title for the level', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-title@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const a = await member('Titled Leader');
    const b = await member('Untitled Leader');
    await send(adminAgent, adminCsrf, 'post', '/api/admin/area-leadership-assignments', { personId: a.id, areaId: path.region.id, title: 'Regional Coordinator' });
    const second = await send(adminAgent, adminCsrf, 'post', '/api/admin/area-leadership-assignments', { personId: b.id, areaId: path.region.id });
    expect(second.status).toBe(201);

    const viewer = await member('Directory Viewer');
    const dir = await viewer.agent.get('/api/member/leadership-directory/areas?country=Cameroon&level=REGION');
    const leaders = dir.body.items[0].leaders;
    expect(leaders.find((l: any) => l.name === 'Titled Leader').title).toBe('Regional Coordinator');
    expect(leaders.find((l: any) => l.name === 'Untitled Leader').title).toBe('Regional Leader');

    // The title can be changed later, and emptied to go back to the usual one.
    const assignment = await prisma.areaLeadershipAssignment.findFirstOrThrow({ where: { personId: a.id } });
    expect((await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-leadership-assignments/${assignment.id}`, { title: '' })).status).toBe(200);
    const again = await viewer.agent.get('/api/member/leadership-directory/areas?country=Cameroon&level=REGION');
    expect(again.body.items[0].leaders.find((l: any) => l.name === 'Titled Leader').title).toBe('Regional Leader');
  });

  it('lists the National Team with the titles the admin gave, in order, to members only', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-national@test.local');
    const first = await member('Team One');
    const second = await member('Team Two');
    const noTitle = await send(adminAgent, adminCsrf, 'post', '/api/admin/national-team', { personId: first.id, title: '' });
    expect(noTitle.status).toBe(400);
    const one = await send(adminAgent, adminCsrf, 'post', '/api/admin/national-team', { personId: first.id, title: 'National Coordinator', sortOrder: 2 });
    expect(one.status).toBe(201);
    await send(adminAgent, adminCsrf, 'post', '/api/admin/national-team', { personId: second.id, title: 'Director of Training', sortOrder: 1 });
    expect((await send(adminAgent, adminCsrf, 'post', '/api/admin/national-team', { personId: first.id, title: 'Again' })).status).toBe(409);

    const viewer = await member('Team Viewer');
    const list = await viewer.agent.get('/api/member/leadership-directory/national-team');
    expect(list.body.items.map((i: any) => [i.name, i.title])).toEqual([
      ['Team Two', 'Director of Training'],
      ['Team One', 'National Coordinator'],
    ]);

    await send(adminAgent, adminCsrf, 'patch', `/api/admin/national-team/${one.body.id}`, { title: 'Chief Coordinator' });
    expect((await viewer.agent.get('/api/member/leadership-directory/national-team')).body.items[1].title).toBe('Chief Coordinator');
    await send(adminAgent, adminCsrf, 'delete', `/api/admin/national-team/${one.body.id}`);
    expect((await viewer.agent.get('/api/member/leadership-directory/national-team')).body.items).toHaveLength(1);

    // A member cannot change the National Team.
    expect((await send(viewer.agent, viewer.csrf, 'post', '/api/admin/national-team', { personId: viewer.id, title: 'Me' })).status).toBeGreaterThanOrEqual(401);
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/member/leadership-directory/national-team')).status).toBe(401);
  });

  it('takes a request for a place that is not on the list, then needs the admin to choose the area', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-typed@test.local');
    const path = await buildCameroonPath(adminAgent, adminCsrf);
    const m = await member('Typed Place Requester');

    // Needs either a place from the list or at least the region typed in.
    expect((await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { note: 'hello' })).status).toBe(400);
    expect((await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { areaId: path.quarter.id, typedRegion: 'Littoral' })).status).toBe(400);

    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', {
      typedCountry: 'Cameroon',
      typedRegion: 'South West',
      typedDivision: 'Fako',
      typedSubdivision: 'Buea',
      typedQuarter: 'Mile 17',
      note: 'I lead a cell group there.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ areaId: null, typedRegion: 'South West', typedQuarter: 'Mile 17', status: 'PENDING' });

    const mine = await m.agent.get('/api/member/area-representation-requests/mine');
    expect(mine.body.items[0]).toMatchObject({ area: null, typedRegion: 'South West', typedDivision: 'Fako' });

    // The admin sees the typed place in the list of requests.
    const list = await adminAgent.get('/api/admin/area-representation-requests?status=PENDING');
    expect(list.body.items.find((r: any) => r.id === created.body.id)).toMatchObject({ area: null, typedSubdivision: 'Buea' });

    // Approving without choosing an area is refused, and says why.
    const refused = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/approve`);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/not on the list yet.*Mile 17/);

    // Choosing an area (and naming the position) approves it.
    const approved = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/approve`, { areaId: path.quarter.id, title: 'Quarter Coordinator' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', areaId: path.quarter.id });
    const assignment = await prisma.areaLeadershipAssignment.findUniqueOrThrow({ where: { id: approved.body.areaLeadershipAssignmentId } });
    expect(assignment).toMatchObject({ personId: m.id, areaId: path.quarter.id, title: 'Quarter Coordinator' });
  });

  it('declining a typed-in place works and tells the member which place', async () => {
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-geo-typed-decline@test.local');
    const m = await member('Typed Decline Requester');
    const created = await send(m.agent, m.csrf, 'post', '/api/member/area-representation-requests', { typedRegion: 'Adamawa', typedDivision: 'Vina' });
    const declined = await send(adminAgent, adminCsrf, 'patch', `/api/admin/area-representation-requests/${created.body.id}/decline`, { decisionNote: 'Not yet.' });
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('DECLINED');
    expect(await prisma.areaLeadershipAssignment.count({ where: { personId: m.id } })).toBe(0);
  });
});
