import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async () => ({ url: 'https://mock-r2.example/upload', expiresAt: new Date(Date.now() + 300000) })),
  createDownloadUrl: vi.fn(async () => ({ url: 'https://mock-r2.example/download', expiresAt: new Date(Date.now() + 300000) })),
  headObject: vi.fn(async () => null),
  deleteObject: vi.fn(async () => {}),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// "Delete my account": hidden for a month (signing in brings it back),
// leader roles back to the central admin, then only the central admin
// deletes it; chats keep "This message was deleted", payments keep their
// amount without the name. Also the public web page (emailed code).
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.131.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}
type Agent = ReturnType<typeof agentWithUniqueIp>;

const PASSWORD = 'GoodPass123!';
let n = 0;

async function signIn(email: string) {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  return { agent, csrf, res };
}

async function member(name: string) {
  n += 1;
  const email = `del${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376557${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  const { agent, csrf } = await signIn(email);
  return { agent, csrf, person, email };
}
type M = Awaited<ReturnType<typeof member>>;

async function admin() {
  n += 1;
  const email = `del-admin-${n}@test.local`;
  const user = await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, user };
}

const post = (who: { agent: Agent; csrf: string }, path: string, body: Record<string, unknown> = {}) => who.agent.post(path).set('X-CSRF-Token', who.csrf).send(body);

async function askToDelete(m: M) {
  const spy = vi.spyOn(EmailService, 'sendAccountDeletionScheduled').mockResolvedValue({ ok: true });
  const res = await post(m, '/api/member/account/delete', { password: PASSWORD, confirm: true });
  return { res, spy };
}

/** A group with both people in it, and its chat. */
async function groupWith(...people: M[]) {
  const community = await prisma.community.create({ data: { name: `Group ${++n}` } });
  for (const p of people) await prisma.communityMembership.create({ data: { personId: p.person.id, communityId: community.id } });
  const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
  return { community, conversation };
}

afterEach(() => vi.restoreAllMocks());

describe('Asking to delete my account', () => {
  it('needs the password, then hides the account, signs it out, hands leader roles back and emails the date', async () => {
    const a = await admin();
    const mary = await member('Mary');
    const other = await member('Other');
    const { community } = await groupWith(mary, other);
    const role = await prisma.roleAssignment.create({ data: { personId: mary.person.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: a.user.id } });

    expect((await post(mary, '/api/member/account/delete', { password: 'wrong', confirm: true })).body.code).toBe('WRONG_PASSWORD');
    expect((await post(mary, '/api/member/account/delete', { password: PASSWORD })).body.code).toBe('NOT_CONFIRMED');

    const { res, spy } = await askToDelete(mary);
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
    expect(new Date(res.body.readyAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ to: mary.email }));

    // Signed out everywhere.
    expect((await mary.agent.get('/api/member/auth/me')).body.member).toBeNull();
    // Hidden from others, out of the group, the leader role back with the central admin.
    expect((await other.agent.get(`/api/member/people?search=Mary`)).body.items).toHaveLength(0);
    expect((await other.agent.get(`/api/member/people/${mary.person.id}`)).status).toBe(404);
    expect((await prisma.communityMembership.findFirst({ where: { personId: mary.person.id } }))?.status).toBe('INACTIVE');
    expect((await prisma.roleAssignment.findUnique({ where: { id: role.id } }))?.status).toBe('ENDED');

    const list = await a.agent.get('/api/admin/account-deletions');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ name: mary.person.name, email: mary.email, ready: false, source: 'APP', returnedRoles: [`Leader of ${community.name}`] });
  });

  it('signing in during the month brings everything back', async () => {
    const a = await admin();
    const mary = await member('Mary');
    const other = await member('Other');
    const { community } = await groupWith(mary, other);
    const role = await prisma.roleAssignment.create({ data: { personId: mary.person.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: a.user.id } });
    await askToDelete(mary);

    const back = await signIn(mary.email);
    expect(back.res.status).toBe(200);
    expect(back.res.body.deletionCancelled).toBe(true);
    expect((await other.agent.get(`/api/member/people/${mary.person.id}`)).status).toBe(200);
    expect((await prisma.communityMembership.findFirst({ where: { personId: mary.person.id } }))?.status).toBe('ACTIVE');
    expect((await prisma.roleAssignment.findUnique({ where: { id: role.id } }))?.status).toBe('ACTIVE');
    expect((await a.agent.get('/api/admin/account-deletions')).body.items).toHaveLength(0);
    // The next sign-in is an ordinary one.
    expect((await signIn(mary.email)).res.body.deletionCancelled).toBeUndefined();
  });

  it('the central admin can keep the account, but deletes only after the month', async () => {
    const a = await admin();
    const mary = await member('Mary');
    await askToDelete(mary);
    const id = (await a.agent.get('/api/admin/account-deletions')).body.items[0].id;
    expect((await post(a, `/api/admin/account-deletions/${id}`, { decision: 'DELETE' })).body.code).toBe('NOT_READY');
    expect((await post(a, `/api/admin/account-deletions/${id}`, { decision: 'KEEP' })).status).toBe(200);
    expect((await prisma.person.findUnique({ where: { id: mary.person.id } }))?.deletionRequestedAt).toBeNull();
    expect((await signIn(mary.email)).res.status).toBe(200);
    // Members can't decide.
    expect((await post(mary, `/api/admin/account-deletions/${id}`, { decision: 'DELETE' })).status).toBe(401);
  });

  it('never deletes the central admin’s own account from the app', async () => {
    const mary = await member('Admin Person');
    await prisma.user.create({ data: { name: 'Admin', email: `adm${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: mary.person.id } });
    expect((await askToDelete(mary)).res.body.code).toBe('ADMIN_ACCOUNT');
  });
});

describe('The final deletion, after the month', () => {
  it('removes the account; chats show "This message was deleted" and can’t be answered; payments keep their amount', async () => {
    const a = await admin();
    const mary = await member('Mary');
    const other = await member('Other');
    const { community, conversation } = await groupWith(mary, other);
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: mary.person.id, body: 'My secret testimony' } });
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: other.person.id, body: 'Amen' } });
    const groupFile = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: mary.person.id, body: '' } });
    await prisma.messageAttachment.create({ data: { messageId: groupFile.id, storageKey: `chat/${groupFile.id}.jpg`, originalFilename: 'me.jpg', mimeType: 'image/jpeg', byteSize: 10, uploadedByPersonId: mary.person.id } });

    await prisma.friendship.create({ data: { requesterPersonId: mary.person.id, addresseePersonId: other.person.id, status: 'ACCEPTED', respondedAt: new Date() } });
    const opened = await post(other, '/api/member/messages/open', { personId: mary.person.id });
    const chatId = opened.body.conversationId ?? opened.body.id;
    expect((await post(mary, `/api/private-messages/conversations/${chatId}/messages`, { body: 'Private words' })).status).toBe(201);

    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'Book', trainingOrder: 1 } });
    const payment = await prisma.bookPayment.create({ data: { personId: mary.person.id, bookId: book.id, bookNumber: 1, amount: 1100, method: 'MANUAL', status: 'CONFIRMED', reference: 'MP1' } });
    const devotional = await prisma.monthlyDevotional.create({ data: { titleEn: 'Oct', contentEn: '-', startDate: new Date(), endDate: new Date(), status: 'PUBLISHED' } });
    const offering = await prisma.devotionalOffering.create({ data: { personId: mary.person.id, devotionalId: devotional.id, amount: 500 } });

    await askToDelete(mary);
    const req0 = await prisma.accountDeletionRequest.findFirst({ where: { personId: mary.person.id } });
    await prisma.accountDeletionRequest.update({ where: { id: req0!.id }, data: { readyAt: new Date(Date.now() - 1000) } });
    const list = await a.agent.get('/api/admin/account-deletions');
    expect(list.body.items[0].ready).toBe(true);
    expect((await post(a, `/api/admin/account-deletions/${req0!.id}`, { decision: 'DELETE' })).status).toBe(200);

    // Gone: no person, no sign-in, the phone number free again.
    expect(await prisma.person.findUnique({ where: { id: mary.person.id } })).toBeNull();
    expect((await signIn(mary.email)).res.status).toBe(401);
    expect(await prisma.person.findFirst({ where: { whatsappNumber: mary.person.whatsappNumber } })).toBeNull();
    expect(storage.deleteObject).toHaveBeenCalledWith({ storageKey: `chat/${groupFile.id}.jpg` });

    // The group chat: her messages are ordinary deleted messages; others' untouched.
    const msgs = await other.agent.get(`/api/communities/${community.id}/conversation/messages`);
    const items = msgs.body.items as any[];
    expect(items).toHaveLength(3);
    const hers = items.filter((m) => m.body !== 'Amen');
    expect(hers.every((m) => m.deleted && m.deletedBySender && m.body === null && m.attachments.length === 0)).toBe(true);
    // Still under her real name, as before.
    expect(hers.every((m) => m.senderName === mary.person.name)).toBe(true);
    expect(JSON.stringify(msgs.body)).not.toContain('My secret testimony');
    expect(JSON.stringify(msgs.body)).not.toMatch(/deleted account|Deleted account/i);
    const stored = await prisma.message.findMany({ where: { conversationId: conversation.id, senderPersonId: { not: other.person.id } } });
    expect(stored.every((m) => m.body === null)).toBe(true);

    // The private chat stays for the other person, emptied, and can't be answered.
    const chat = await other.agent.get(`/api/private-messages/conversations/${chatId}/messages`);
    expect(chat.status).toBe(200);
    const theirs = chat.body.items.filter((m: any) => !m.isOwn);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ deleted: true, deletedBySender: true, body: null });
    expect((await post(other, `/api/private-messages/conversations/${chatId}/messages`, { body: 'Hello?' })).body.code).toBe('UNAVAILABLE');

    // Payments and offerings: amount and date kept, no name.
    expect(await prisma.bookPayment.findUnique({ where: { id: payment.id } })).toMatchObject({ personId: null, amount: 1100 });
    expect(await prisma.devotionalOffering.findUnique({ where: { id: offering.id } })).toMatchObject({ personId: null, amount: 500 });

    // The placeholder is nobody: not in the admin's people list.
    const people = await a.agent.get('/api/admin/people?pageSize=100');
    expect((people.body.items as any[]).some((p) => p.whatsappNumber.startsWith('deleted:'))).toBe(false);
    // The closed request keeps no personal details.
    const done = await prisma.accountDeletionRequest.findUnique({ where: { id: req0!.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', personName: null, email: null, whatsappNumber: null, personId: null });
  });
});

describe('The public "Delete your account" web page', () => {
  it('emails a code to the account’s address, and the right code starts the month of waiting', async () => {
    const mary = await member('Mary');
    const web = agentWithUniqueIp();
    const { csrf } = await bootstrap(web as any);
    const spy = vi.spyOn(EmailService, 'sendAccountDeletionCode').mockResolvedValue({ ok: true });
    vi.spyOn(EmailService, 'sendAccountDeletionScheduled').mockResolvedValue({ ok: true });

    const unknown = await web.post('/api/account-deletion/request-code').set('X-CSRF-Token', csrf).send({ email: 'nobody@example.com' });
    const known = await web.post('/api/account-deletion/request-code').set('X-CSRF-Token', csrf).send({ email: mary.email.toUpperCase() });
    // The same answer either way: it never tells who has an account.
    expect(known.body).toEqual(unknown.body);
    expect(spy).toHaveBeenCalledTimes(1);
    const code = spy.mock.calls[0][0].code;

    expect((await web.post('/api/account-deletion/confirm').set('X-CSRF-Token', csrf).send({ email: mary.email, code: code === '000000' ? '111111' : '000000' })).body.code).toBe('BAD_CODE');
    const ok = await web.post('/api/account-deletion/confirm').set('X-CSRF-Token', csrf).send({ email: mary.email, code });
    expect(ok.status).toBe(200);
    expect(ok.body.days).toBe(30);
    expect((await prisma.accountDeletionRequest.findFirst({ where: { personId: mary.person.id } }))?.source).toBe('WEB');
    // A code works once.
    expect((await web.post('/api/account-deletion/confirm').set('X-CSRF-Token', csrf).send({ email: mary.email, code })).body.code).toBe('BAD_CODE');
  });
});
