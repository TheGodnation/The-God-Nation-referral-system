import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Phase 1 (profile overhaul) — Representation Requests: a Member submits a
// free-text "I want to represent X" request; Admin approves/declines; an
// approved one shows on the Member's own profile card and in the public
// Leadership Directory. Deliberately NOT tied to Geography or Community.
const app = createApp();

let ipCounter = 20000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.117.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const whatsapp = `+2376705${String(n).padStart(5, '0')}`;
  const email = `reprequest${n}@example.com`;
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

const send = (m: Member, path: string, body: Record<string, unknown> = {}) => m.agent.post(path).set('X-CSRF-Token', m.csrf).send(body);

describe('Representation Requests — member submission', () => {
  it('submits a request, sees it in "mine" as PENDING, and it does not yet appear on the profile or directory', async () => {
    const a = await member('Requester One');
    const res = await send(a, '/api/member/representation-requests', { label: 'Yaoundé III Youth', note: 'I lead the weekly prayer call.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ label: 'Yaoundé III Youth', status: 'PENDING' });

    const mine = await a.agent.get('/api/member/representation-requests/mine');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].status).toBe('PENDING');

    const card = await a.agent.get(`/api/member/people/${a.id}`);
    expect(card.body.representations).toEqual([]);

    const directory = await a.agent.get('/api/member/leadership-directory');
    expect(directory.body.items).toEqual([]);
  });

  it('rejects a second pending request while one is already pending', async () => {
    const a = await member('Requester Two');
    const first = await send(a, '/api/member/representation-requests', { label: 'Douala Central' });
    expect(first.status).toBe(201);
    const second = await send(a, '/api/member/representation-requests', { label: 'Something Else' });
    expect(second.status).toBe(409);
  });

  it('rejects a label that is too short', async () => {
    const a = await member('Requester Three');
    const res = await send(a, '/api/member/representation-requests', { label: 'X' });
    expect(res.status).toBe(400);
  });

  it('lets the member withdraw their own pending request, freeing them to submit a new one', async () => {
    const a = await member('Requester Four');
    const created = await send(a, '/api/member/representation-requests', { label: 'Bafoussam North' });
    const withdraw = await a.agent.delete(`/api/member/representation-requests/${created.body.id}`).set('X-CSRF-Token', a.csrf);
    expect(withdraw.status).toBe(200);

    const mine = await a.agent.get('/api/member/representation-requests/mine');
    expect(mine.body.items).toHaveLength(0);

    const again = await send(a, '/api/member/representation-requests', { label: 'Bafoussam North, second try' });
    expect(again.status).toBe(201);
  });

  it("a member cannot withdraw another member's request", async () => {
    const a = await member('Requester Five');
    const b = await member('Requester Six');
    const created = await send(a, '/api/member/representation-requests', { label: 'Garoua East' });
    const res = await b.agent.delete(`/api/member/representation-requests/${created.body.id}`).set('X-CSRF-Token', b.csrf);
    expect(res.status).toBe(404);
    const stillThere = await prisma.representationRequest.findUnique({ where: { id: created.body.id } });
    expect(stillThere).not.toBeNull();
  });

  it('requires authentication and CSRF', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.post('/api/member/representation-requests').send({ label: 'Nowhere' })).status).toBe(401);

    const a = await member('Requester Seven');
    const res = await a.agent.post('/api/member/representation-requests').send({ label: 'No CSRF' });
    expect(res.status).toBe(403);
  });
});

describe('Representation Requests — Admin review', () => {
  it('rejects an unauthenticated or non-Admin review request', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/admin/representation-requests')).status).toBe(401);

    const a = await member('Requester Eight');
    const res = await a.agent.get('/api/admin/representation-requests');
    expect(res.status).toBe(401);
  });

  it('Admin can list PENDING requests and approve one, which then shows on the profile card and in the directory', async () => {
    const a = await member('Requester Nine');
    await send(a, '/api/member/representation-requests', { label: 'Kribi Fishermen Fellowship' });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-reprequest-approve@test.local');
    const list = await adminAgent.get('/api/admin/representation-requests?status=PENDING');
    expect(list.status).toBe(200);
    const row = list.body.items.find((r: any) => r.person.id === a.id);
    expect(row).toBeTruthy();

    const approve = await adminAgent
      .patch(`/api/admin/representation-requests/${row.id}/approve`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ decisionNote: 'Confirmed with the local fellowship.' });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');
    expect(approve.body.decidedAt).toBeTruthy();
    expect(approve.body.decisionNote).toBe('Confirmed with the local fellowship.');

    const card = await a.agent.get(`/api/member/people/${a.id}`);
    expect(card.body.representations).toEqual(['Kribi Fishermen Fellowship']);

    const directory = await a.agent.get('/api/member/leadership-directory');
    expect(directory.body.items).toEqual([{ personId: a.id, name: 'Requester Nine', photoUrl: null, label: 'Kribi Fishermen Fellowship' }]);
  });

  it('Admin can decline a request, recording a decision note, and it never reaches the directory', async () => {
    const a = await member('Requester Ten');
    const created = await send(a, '/api/member/representation-requests', { label: 'Ebolowa Teens' });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-reprequest-decline@test.local');
    const decline = await adminAgent
      .patch(`/api/admin/representation-requests/${created.body.id}/decline`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ decisionNote: 'Not enough information yet.' });
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe('DECLINED');

    const directory = await a.agent.get('/api/member/leadership-directory');
    expect(directory.body.items).toEqual([]);
  });

  it('a non-Admin (Leader) cannot approve or decline', async () => {
    const { user } = await createLeader('Some Leader', 'leader-reprequest@test.local', 'LRQ1CODE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-reprequest@test.local', password: 'password123' });

    const a = await member('Requester Eleven');
    const created = await send(a, '/api/member/representation-requests', { label: 'Limbe Coastal' });

    const res = await agent.patch(`/api/admin/representation-requests/${created.body.id}/approve`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(403);
    void user;
  });

  it('approving or declining never creates a RoleAssignment or CommunityMembership', async () => {
    const a = await member('Requester Twelve');
    const created = await send(a, '/api/member/representation-requests', { label: 'Maroua West' });

    const roleCountBefore = await prisma.roleAssignment.count();
    const membershipCountBefore = await prisma.communityMembership.count();

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-reprequest-noeffect@test.local');
    await adminAgent.patch(`/api/admin/representation-requests/${created.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});

    expect(await prisma.roleAssignment.count()).toBe(roleCountBefore);
    expect(await prisma.communityMembership.count()).toBe(membershipCountBefore);
  });

  it('a second decision on an already-decided request is rejected', async () => {
    const a = await member('Requester Thirteen');
    const created = await send(a, '/api/member/representation-requests', { label: 'Bamenda Ridge' });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-reprequest-twice@test.local');
    await adminAgent.patch(`/api/admin/representation-requests/${created.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});
    const second = await adminAgent.patch(`/api/admin/representation-requests/${created.body.id}/decline`).set('X-CSRF-Token', adminCsrf).send({});
    expect(second.status).toBe(409);
  });

  it('notifies the member when their request is approved or declined', async () => {
    const a = await member('Requester Fourteen');
    const approved = await send(a, '/api/member/representation-requests', { label: 'Notified Approved' });
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-reprequest-notify-a@test.local');
    await adminAgent.patch(`/api/admin/representation-requests/${approved.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});
    const approvedNote = await prisma.notification.findFirst({ where: { recipientPersonId: a.id, type: 'REPRESENTATION_REQUEST_APPROVED' } });
    expect(approvedNote).not.toBeNull();

    const b = await member('Requester Fifteen');
    const declined = await send(b, '/api/member/representation-requests', { label: 'Notified Declined' });
    const { agent: adminAgent2, csrf: adminCsrf2 } = await loginAsAdmin('admin-reprequest-notify-b@test.local');
    await adminAgent2.patch(`/api/admin/representation-requests/${declined.body.id}/decline`).set('X-CSRF-Token', adminCsrf2).send({});
    const declinedNote = await prisma.notification.findFirst({ where: { recipientPersonId: b.id, type: 'REPRESENTATION_REQUEST_DECLINED' } });
    expect(declinedNote).not.toBeNull();
  });
});
