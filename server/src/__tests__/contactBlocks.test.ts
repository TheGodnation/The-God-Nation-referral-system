import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Three ways to delete a person: free to register again, only with the admin's approval, or never.
// The number and email are kept out for the last two; the person is never told; attempts are counted.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.141.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}

let n = 0;
const phone = () => `+23765571${String(++n).padStart(4, '0')}`;
const mail = (tag: string) => `${tag}${n}@example.com`;

async function admin() {
  n += 1;
  const email = `kept-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}
type Admin = Awaited<ReturnType<typeof admin>>;

/** A public sign-up. Returns the reply and whether a sign-in email went out. */
async function signup(email: string, whatsapp: string) {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/signup').set('X-CSRF-Token', csrf).send({ email, whatsapp, password: 'Testpass123', language: 'en' });
  const sent = spy.mock.calls.length > 0;
  spy.mockRestore();
  return { res, sent };
}

const personOf = (whatsapp: string) => prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
const del = (a: Admin, id: string, body?: Record<string, unknown>) => a.agent.delete(`/api/admin/people/${id}`).set('X-CSRF-Token', a.csrf).send(body ?? {});
const get = (a: Admin, path: string) => a.agent.get(path);
const post = (a: Admin, path: string, body: Record<string, unknown> = {}) => a.agent.post(path).set('X-CSRF-Token', a.csrf).send(body);

/** Signs someone up and returns their person, then deletes them with the given choice. */
async function joinThenDelete(a: Admin, choice?: Record<string, unknown>) {
  const whatsapp = phone();
  const email = mail('kept');
  expect((await signup(email, whatsapp)).sent).toBe(true);
  const person = (await personOf(whatsapp))!;
  const res = await del(a, person.id, choice);
  expect(res.status).toBe(204);
  expect(await personOf(whatsapp)).toBeNull();
  return { whatsapp, email, personId: person.id };
}

afterEach(() => vi.restoreAllMocks());

describe('Delete, free to return', () => {
  it('lets the same person register again as a brand-new member, and the old sign-up record keeps only the statistics', async () => {
    const a = await admin();
    const whatsapp = phone();
    const email = mail('free');
    await signup(email, whatsapp);
    const before = (await personOf(whatsapp))!;
    // Pretend the old record came from an ad, so we can see the statistics survive.
    await prisma.registration.updateMany({ where: { personId: before.id }, data: { utmSource: 'facebook', fbclid: 'abc' } });
    expect((await del(a, before.id)).status).toBe(204);

    const old = await prisma.registration.findMany({ where: { utmSource: 'facebook', name: 'Member', email: null } });
    expect(old.length).toBeGreaterThanOrEqual(1);
    expect(old.every((r) => r.normalizedWhatsApp.startsWith('deleted:') && r.fbclid === null && r.personId === null)).toBe(true);
    expect(await prisma.contactBlock.count({ where: { value: { in: [whatsapp, email] } } })).toBe(0);

    const again = await signup(email, whatsapp);
    expect(again.sent).toBe(true);
    const fresh = await personOf(whatsapp);
    expect(fresh).not.toBeNull();
    expect(fresh!.id).not.toBe(before.id);
  });
});

describe('Delete, never allowed back', () => {
  it('refuses the same number or the same email, says nothing to the person, counts the attempts, and can be lifted', async () => {
    const a = await admin();
    const gone = await joinThenDelete(a, { mode: 'NEVER', note: 'Took money from members' });
    expect(await prisma.contactBlock.count({ where: { groupId: { not: '' }, value: { in: [gone.whatsapp, gone.email] }, status: 'ACTIVE', mode: 'NEVER' } })).toBe(2);

    // Same number, a different email.
    const byNumber = await signup(mail('other'), gone.whatsapp);
    expect(byNumber.res.status).toBe(200);
    expect(byNumber.res.body.message).toContain('Check your email');
    expect(byNumber.sent).toBe(false);
    expect(await personOf(gone.whatsapp)).toBeNull();
    // Same email, a different number.
    const other = phone();
    const byEmail = await signup(gone.email, other);
    expect(byEmail.res.body.message).toContain('Check your email');
    expect(byEmail.sent).toBe(false);
    expect(await personOf(other)).toBeNull();
    // A stranger is not affected.
    expect((await signup(mail('stranger'), phone())).sent).toBe(true);

    const list = (await get(a, '/api/admin/account-deletions/kept-out')).body.items as any[];
    const entry = list.find((g) => g.whatsappNumbers.includes(gone.whatsapp));
    expect(entry).toMatchObject({ mode: 'NEVER', status: 'ACTIVE', note: 'Took money from members', attempts: 2 });
    expect(entry.emails).toContain(gone.email);
    // The one with attempts is shown first.
    expect(list[0].groupId).toBe(entry.groupId);

    // "Never" cannot be turned into "never" again; it can be lifted.
    expect((await post(a, `/api/admin/account-deletions/kept-out/${entry.groupId}/never`)).status).toBe(404);
    expect((await post(a, `/api/admin/account-deletions/kept-out/${entry.groupId}/allow`)).status).toBe(200);
    expect((await signup(gone.email, gone.whatsapp)).sent).toBe(true);
    expect(await personOf(gone.whatsapp)).not.toBeNull();
    expect((await post(a, `/api/admin/account-deletions/kept-out/${entry.groupId}/allow`)).status).toBe(404);
  });

  it('applies when a member’s own request is approved after the month, and the admin cannot add the number by hand', async () => {
    const a = await admin();
    const whatsapp = phone();
    const email = mail('own');
    await signup(email, whatsapp);
    const person = (await personOf(whatsapp))!;
    const request = await prisma.accountDeletionRequest.create({
      data: { personId: person.id, source: 'APP', personName: person.name, email, whatsappNumber: whatsapp, requestedAt: new Date(Date.now() - 31 * 86400000), readyAt: new Date(Date.now() - 86400000) },
    });
    const res = await post(a, `/api/admin/account-deletions/${request.id}`, { decision: 'DELETE', mode: 'NEVER', note: 'Fraud' });
    expect(res.status).toBe(200);
    expect((await signup(email, whatsapp)).sent).toBe(false);
    expect(await personOf(whatsapp)).toBeNull();

    const made = await post(a, '/api/admin/people', { name: 'Back door', whatsappNumber: whatsapp });
    expect(made.status).toBe(409);
    expect(made.body.code).toBe('KEPT_OUT');
  });
});

describe('Delete, return only with approval', () => {
  it('refuses until the admin allows it; "keep out for good" makes it permanent', async () => {
    const a = await admin();
    const gone = await joinThenDelete(a, { mode: 'APPROVAL', note: 'Check with the pastor first' });

    const attempt = await signup(gone.email, gone.whatsapp);
    expect(attempt.sent).toBe(false);
    expect(attempt.res.body.message).toContain('Check your email');
    expect(await personOf(gone.whatsapp)).toBeNull();

    const entry = ((await get(a, '/api/admin/account-deletions/kept-out')).body.items as any[]).find((g) => g.whatsappNumbers.includes(gone.whatsapp));
    expect(entry).toMatchObject({ mode: 'APPROVAL', status: 'ACTIVE', attempts: 1 });

    // Saying no turns it into "never".
    expect((await post(a, `/api/admin/account-deletions/kept-out/${entry.groupId}/never`)).status).toBe(200);
    expect((await signup(gone.email, gone.whatsapp)).sent).toBe(false);
    const after = ((await get(a, '/api/admin/account-deletions/kept-out')).body.items as any[]).find((g) => g.groupId === entry.groupId);
    expect(after.mode).toBe('NEVER');
  });

  it('lets the person register once the admin approves, as a brand-new member', async () => {
    const a = await admin();
    const gone = await joinThenDelete(a, { mode: 'APPROVAL' });
    expect((await signup(gone.email, gone.whatsapp)).sent).toBe(false);
    const entry = ((await get(a, '/api/admin/account-deletions/kept-out')).body.items as any[]).find((g) => g.whatsappNumbers.includes(gone.whatsapp));
    expect((await post(a, `/api/admin/account-deletions/kept-out/${entry.groupId}/allow`)).status).toBe(200);

    expect((await signup(gone.email, gone.whatsapp)).sent).toBe(true);
    const fresh = (await personOf(gone.whatsapp))!;
    expect(fresh.id).not.toBe(gone.personId);
    const decided = ((await get(a, '/api/admin/account-deletions/kept-out')).body.items as any[]).find((g) => g.groupId === entry.groupId);
    expect(decided.status).toBe('APPROVED');
  });

  it('is for the central admin only', async () => {
    const agent = agentWithUniqueIp();
    await bootstrap(agent as any);
    expect((await agent.get('/api/admin/account-deletions/kept-out')).status).toBe(401);
  });

  it('refuses a choice that is not one of the three', async () => {
    const a = await admin();
    const whatsapp = phone();
    await signup(mail('bad'), whatsapp);
    const person = (await personOf(whatsapp))!;
    expect((await del(a, person.id, { mode: 'FOREVER' })).status).toBe(400);
    expect(await personOf(whatsapp)).not.toBeNull();
  });
});

describe('A person who was kept out and then deleted again', () => {
  it('goes back on the list as active', async () => {
    const a = await admin();
    const gone = await joinThenDelete(a, { mode: 'APPROVAL' });
    const entry = ((await get(a, '/api/admin/account-deletions/kept-out')).body.items as any[]).find((g) => g.whatsappNumbers.includes(gone.whatsapp));
    await post(a, `/api/admin/account-deletions/kept-out/${entry.groupId}/allow`);
    await signup(gone.email, gone.whatsapp);
    const again = (await personOf(gone.whatsapp))!;
    expect((await del(a, again.id, { mode: 'NEVER' })).status).toBe(204);
    expect((await signup(gone.email, gone.whatsapp)).sent).toBe(false);
    const rows = await prisma.contactBlock.findMany({ where: { value: gone.whatsapp } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', mode: 'NEVER' });
  });
});
