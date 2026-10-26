import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Referral earnings: when someone you invited pays for a book you earn a share
// (500 FCFA by default), it waits 3 days, and from 5,000 FCFA you can ask to
// be paid out; the central admin sends the money and records it.
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
type Agent = ReturnType<typeof agentWithUniqueIp>;
type Who = { agent: Agent; csrf: string; id: string };

let n = 0;
async function member(name: string): Promise<Who> {
  n += 1;
  const whatsapp = `+2376715${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `earn${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}

async function admin() {
  n += 1;
  const email = `earn-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

const send = (who: { agent: Agent; csrf: string }, method: 'post' | 'patch' | 'delete', path: string, body: Record<string, unknown> = {}) =>
  who.agent[method](path).set('X-CSRF-Token', who.csrf).send(body);

/** `buyer` joined through `referrer`'s link (the friendship that sign-up creates). */
async function referred(referrer: Who, buyer: Who) {
  await prisma.friendship.create({ data: { requesterPersonId: referrer.id, addresseePersonId: buyer.id, status: 'ACCEPTED', origin: 'REFERRAL', respondedAt: new Date() } });
}

async function book(order: number) {
  return prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `Book ${order}`, trainingOrder: order } });
}

/** The admin records that `buyer` paid for the book (cash / a transfer seen on the phone). */
const recordPayment = (a: { agent: Agent; csrf: string }, buyer: Who, bookId: string) => send(a, 'post', '/api/admin/library/payments', { personId: buyer.id, bookId });

const DAY = 24 * 60 * 60 * 1000;
afterEach(() => vi.clearAllMocks());

describe('Referral earnings: crediting', () => {
  it('credits the person who invited the buyer 500 FCFA, waiting 3 days, and tells them', async () => {
    const a = await admin();
    const grace = await member('Referrer Grace');
    const ben = await member('Ben Buyer');
    await referred(grace, ben);
    const b1 = await book(1);

    const before = Date.now();
    expect((await recordPayment(a, ben, b1.id)).status).toBe(201);

    const earning = await prisma.referralEarning.findFirstOrThrow({ where: { referrerPersonId: grace.id } });
    expect(earning).toMatchObject({ buyerPersonId: ben.id, amount: 500, bookNumber: 1, status: 'ACTIVE', payoutId: null });
    expect(earning.availableAt.getTime()).toBeGreaterThanOrEqual(before + 3 * DAY - 5000);
    expect(earning.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 3 * DAY + 5000);
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: grace.id, type: 'REFERRAL_EARNING' } })).not.toBeNull();

    const mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.summary).toEqual({ waiting: 500, available: 0, paidOut: 0, inRequest: 0, total: 500 });
    expect(mine.body.items).toEqual([expect.objectContaining({ buyerFirstName: 'Ben', bookNumber: 1, amount: 500, state: 'WAITING' })]);
    expect(mine.body.settings).toEqual({ commission: 500, holdDays: 3, minimum: 5000 });
    // The buyer earns nothing from their own purchase.
    expect((await ben.agent.get('/api/member/earnings')).body.summary.total).toBe(0);
  });

  it('earns for every book the invited person pays for', async () => {
    const a = await admin();
    const grace = await member('Repeat Referrer');
    const ben = await member('Repeat Buyer');
    await referred(grace, ben);
    await recordPayment(a, ben, (await book(1)).id);
    await recordPayment(a, ben, (await book(2)).id);
    expect(await prisma.referralEarning.count({ where: { referrerPersonId: grace.id } })).toBe(2);
  });

  it('credits when the admin confirms a claimed Mobile Money payment, too', async () => {
    const a = await admin();
    const grace = await member('Claim Referrer');
    const ben = await member('Claim Buyer');
    await referred(grace, ben);
    const b1 = await book(1);
    const claim = await prisma.bookPayment.create({ data: { personId: ben.id, bookId: b1.id, bookNumber: 1, amount: 1200, method: 'MANUAL', status: 'CLAIMED', reference: 'MP1' } });
    expect((await send(a, 'post', `/api/admin/library/payments/${claim.id}`, { decision: 'CONFIRM' })).status).toBe(200);
    expect(await prisma.referralEarning.count({ where: { referrerPersonId: grace.id, bookPaymentId: claim.id } })).toBe(1);
  });

  it('credits when the payment company confirms an automatic payment, once', async () => {
    const grace = await member('Auto Referrer');
    const ben = await member('Auto Buyer');
    await referred(grace, ben);
    const b1 = await book(1);
    await prisma.bookPayment.create({ data: { personId: ben.id, bookId: b1.id, bookNumber: 1, amount: 1200, method: 'AUTOMATIC', status: 'PENDING', provider: 'testpay', providerRef: 'earn-tp-1' } });
    const { registerPaymentProvider } = await import('../lib/payments');
    registerPaymentProvider({
      name: 'testpay',
      requestPayment: async () => ({ providerRef: 'x' }),
      readNotification: async (req) => (req.body?.secret === 'ok' ? { providerRef: req.body.ref, status: req.body.status } : null),
    });
    process.env.PAYMENT_PROVIDER = 'testpay';
    try {
      const hook = request(app);
      await hook.post('/api/payments/webhook').send({ secret: 'ok', ref: 'earn-tp-1', status: 'CONFIRMED' });
      await hook.post('/api/payments/webhook').send({ secret: 'ok', ref: 'earn-tp-1', status: 'CONFIRMED' });
      expect(await prisma.referralEarning.count({ where: { referrerPersonId: grace.id } })).toBe(1);
    } finally {
      delete process.env.PAYMENT_PROVIDER;
    }
  });

  it('credits nobody when the buyer was not invited, a payment failed, or the referrer is the ministry itself', async () => {
    const a = await admin();
    const loner = await member('Uninvited Buyer');
    await recordPayment(a, loner, (await book(1)).id);

    // The "catch-all" person people are linked to when they join without a link earns nothing.
    const catchAll = await member('Catch All');
    const joined = await member('Joined Without Link');
    await referred(catchAll, joined);
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { defaultReferrerPersonId: catchAll.id }, create: { id: 'singleton', defaultReferrerPersonId: catchAll.id } });
    await recordPayment(a, joined, (await book(2)).id);

    // The central admin's own profile does not earn either.
    const boss = await member('Boss Profile');
    await prisma.user.create({ data: { name: 'Central Admin', email: 'earn-boss@test.local', passwordHash: 'x', role: 'ADMIN', personId: boss.id } });
    const invitedByBoss = await member('Invited By Boss');
    await referred(boss, invitedByBoss);
    await recordPayment(a, invitedByBoss, (await book(3)).id);

    // A payment that was rejected or failed never earns.
    const grace = await member('Failed Referrer');
    const ben = await member('Failed Buyer');
    await referred(grace, ben);
    const b4 = await book(4);
    const claim = await prisma.bookPayment.create({ data: { personId: ben.id, bookId: b4.id, bookNumber: 4, amount: 1200, method: 'MANUAL', status: 'CLAIMED' } });
    await send(a, 'post', `/api/admin/library/payments/${claim.id}`, { decision: 'REJECT' });

    expect(await prisma.referralEarning.count()).toBe(0);
  });

  it('follows the amount and waiting days the admin sets', async () => {
    const a = await admin();
    const set = await send(a, 'patch', '/api/admin/referral-earnings/settings', { referralCommission: 300, commissionHoldDays: 0, payoutMinimum: 1000 });
    expect(set.status).toBe(200);
    expect((await send(a, 'patch', '/api/admin/referral-earnings/settings', { referralCommission: -5, commissionHoldDays: 3, payoutMinimum: 5000 })).status).toBe(400);
    expect((await a.agent.get('/api/admin/referral-earnings/settings')).body).toEqual({ referralCommission: 300, commissionHoldDays: 0, payoutMinimum: 1000 });

    const grace = await member('Custom Referrer');
    const ben = await member('Custom Buyer');
    await referred(grace, ben);
    await recordPayment(a, ben, (await book(1)).id);
    const mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.summary).toMatchObject({ available: 300, waiting: 0 });
    expect(mine.body.items[0].state).toBe('AVAILABLE');
  });
});

/** Gives `who` ten earnings (5,000 FCFA) that are ready to be paid out. */
async function seedAvailable(who: Who, count = 10) {
  const b = await book(Math.floor(Math.random() * 1e6) + 100);
  for (let i = 0; i < count; i++) {
    const buyer = await member(`Seed Buyer ${n}`);
    const payment = await prisma.bookPayment.create({ data: { personId: buyer.id, bookId: b.id, bookNumber: 1, amount: 1200, method: 'MANUAL', status: 'CONFIRMED' } });
    await prisma.referralEarning.create({
      data: { referrerPersonId: who.id, buyerPersonId: buyer.id, bookPaymentId: payment.id, bookNumber: 1, amount: 500, availableAt: new Date(Date.now() - DAY) },
    });
  }
}

describe('Referral earnings: payouts', () => {
  it('needs the minimum balance, then takes everything available as one request', async () => {
    const grace = await member('Payout Grace');
    await seedAvailable(grace, 9); // 4,500
    let mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.canRequestPayout).toBe(false);
    const early = await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237 670 000 111', payeeName: 'Grace Ngwa' });
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'BELOW_MINIMUM', minimum: 5000, available: 4500 });

    await seedAvailable(grace, 1); // 5,000
    mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.canRequestPayout).toBe(true);
    expect((await send(grace, 'post', '/api/member/earnings/payout', { phone: '12', payeeName: 'G' })).status).toBe(400);

    const asked = await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237 670 000 111', payeeName: 'Grace Ngwa' });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ amount: 5000, status: 'REQUESTED' });
    mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.summary).toMatchObject({ available: 0, inRequest: 5000, paidOut: 0, total: 5000 });
    expect(mine.body.canRequestPayout).toBe(false);
    expect(mine.body.payouts[0]).toMatchObject({ amount: 5000, phone: '+237670000111', status: 'REQUESTED' });
    // Only one request at a time.
    expect((await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237670000111', payeeName: 'Grace Ngwa' })).body.code).toMatch(/ALREADY_REQUESTED|BELOW_MINIMUM/);
  });

  it('the admin sends the money and records it: paid, the member is told, and it counts as paid out', async () => {
    const a = await admin();
    const grace = await member('Paid Grace');
    await seedAvailable(grace);
    const asked = await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237670000222', payeeName: 'Grace Ngwa' });

    const list = await a.agent.get('/api/admin/payouts');
    expect(list.body.items).toEqual([expect.objectContaining({ id: asked.body.id, amount: 5000, phone: '+237670000222', payeeName: 'Grace Ngwa', person: expect.objectContaining({ name: 'Paid Grace' }) })]);

    const paid = await send(a, 'patch', `/api/admin/payouts/${asked.body.id}/paid`, { reference: 'MP-SENT-1' });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'PAID', reference: 'MP-SENT-1' });
    expect((await send(a, 'patch', `/api/admin/payouts/${asked.body.id}/paid`, {})).status).toBe(409);
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: grace.id, type: 'REFERRAL_PAYOUT_PAID' } })).not.toBeNull();
    const mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.summary).toMatchObject({ paidOut: 5000, inRequest: 0, available: 0 });
    expect(mine.body.items.every((i: any) => i.state === 'PAID')).toBe(true);
    expect(mine.body.canRequestPayout).toBe(false);
  });

  it('rejecting a request, or the member withdrawing it, puts the earnings back in the balance', async () => {
    const a = await admin();
    const grace = await member('Rejected Grace');
    await seedAvailable(grace);
    const first = await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237670000333', payeeName: 'Grace Ngwa' });
    expect((await send(a, 'patch', `/api/admin/payouts/${first.body.id}/reject`, { note: 'Number not valid' })).body.status).toBe('REJECTED');
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: grace.id, type: 'REFERRAL_PAYOUT_REJECTED' } })).not.toBeNull();
    let mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.summary).toMatchObject({ available: 5000, inRequest: 0 });

    const second = await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237670000444', payeeName: 'Grace Ngwa' });
    expect(second.status).toBe(201);
    expect((await send(grace, 'delete', `/api/member/earnings/payout/${second.body.id}`)).status).toBe(200);
    mine = await grace.agent.get('/api/member/earnings');
    expect(mine.body.summary).toMatchObject({ available: 5000, inRequest: 0 });
    expect(mine.body.canRequestPayout).toBe(true);
    // Nobody else can withdraw someone's request.
    const other = await member('Someone Else');
    const third = await send(grace, 'post', '/api/member/earnings/payout', { phone: '+237670000555', payeeName: 'Grace Ngwa' });
    expect((await send(other, 'delete', `/api/member/earnings/payout/${third.body.id}`)).status).toBe(404);
  });

  it('shows the admin what is owed, and lets a not-yet-requested earning be taken back', async () => {
    const a = await admin();
    const grace = await member('Owed Grace');
    const ben = await member('Owed Buyer');
    await referred(grace, ben);
    await recordPayment(a, ben, (await book(1)).id);
    await seedAvailable(grace, 2);

    const owed = await a.agent.get('/api/admin/referral-earnings');
    expect(owed.body.totals).toEqual({ waiting: 500, available: 1000, inRequest: 0, paidOut: 0 });
    expect(owed.body.items.length).toBe(3);

    const waiting = await prisma.referralEarning.findFirstOrThrow({ where: { referrerPersonId: grace.id, buyerPersonId: ben.id } });
    expect((await send(a, 'post', `/api/admin/referral-earnings/${waiting.id}/reverse`)).status).toBe(200);
    expect((await send(a, 'post', `/api/admin/referral-earnings/${waiting.id}/reverse`)).status).toBe(409);
    expect((await grace.agent.get('/api/member/earnings')).body.summary).toMatchObject({ waiting: 0, available: 1000, total: 1000 });
  });

  it('keeps earnings private and the admin screens for the admin', async () => {
    const grace = await member('Private Grace');
    await seedAvailable(grace, 1);
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/member/earnings')).status).toBe(401);
    expect((await grace.agent.get('/api/admin/payouts')).status).toBeGreaterThanOrEqual(401);
    expect((await send(grace, 'patch', '/api/admin/referral-earnings/settings', { referralCommission: 9999, commissionHoldDays: 0, payoutMinimum: 100 })).status).toBeGreaterThanOrEqual(401);
    const other = await member('Nosy Member');
    expect((await other.agent.get('/api/member/earnings')).body.items).toEqual([]);
  });
});
