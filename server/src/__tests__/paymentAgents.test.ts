import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Paying for a book through a payment agent: pick an agent, chat, pay, send the
// transaction ID, and the agent confirms that the money reached the ministry.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.142.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const whatsapp = `+2376716${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `pagent${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}

async function admin() {
  n += 1;
  const email = `pagent-admin-${n}@test.local`;
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

/** A member who has begun the training (Book 1 is open), and an appointed agent. */
async function setup(opts: { dailyLimit?: number; instructions?: string } = {}) {
  const a = await admin();
  const b1 = await book(1);
  const buyer = await member('Ben Buyer');
  expect((await send(buyer, 'post', '/api/member/training/request')).status).toBe(201);
  const agentWho = await member('Aggie Agent');
  const created = await send(a, 'post', '/api/admin/payment-agents', { personId: agentWho.id, label: 'Douala office', dailyLimit: opts.dailyLimit, instructions: opts.instructions });
  expect(created.status).toBe(201);
  return { a, b1, buyer, agentWho, agentId: created.body.id as string };
}

const openOrder = (buyer: Who, agentId: string, bookId: string) => send(buyer, 'post', '/api/member/pay/orders', { agentId, bookId });

afterEach(() => vi.clearAllMocks());

describe('Payment agents: choosing an agent and opening an order', () => {
  it('lists agents (online first, never yourself), and opens an order with the instructions as the agent\'s first message', async () => {
    const { b1, buyer, agentWho, agentId } = await setup({ instructions: 'Send 1,200 FCFA to MTN 670 000 000 (The God Nation).' });
    await agentWho.agent.get('/api/member/pay/me'); // the agent's app is open: online
    const list = await buyer.agent.get(`/api/member/pay/agents?bookId=${b1.id}`);
    expect(list.body.items).toEqual([expect.objectContaining({ id: agentId, name: 'Aggie Agent', label: 'Douala office', online: true, busy: false })]);
    expect(list.body.activeOrder).toBeNull();
    expect((await agentWho.agent.get(`/api/member/pay/agents`)).body.items).toEqual([]);

    const opened = await openOrder(buyer, agentId, b1.id);
    expect(opened.status).toBe(201);
    const view = await buyer.agent.get(`/api/member/pay/orders/${opened.body.id}`);
    expect(view.body).toMatchObject({ role: 'BUYER', status: 'OPEN', amount: 1200, bookNumber: 1, canClaim: true, counterpart: { name: 'Aggie Agent', online: true } });
    expect(view.body.messages).toEqual([expect.objectContaining({ mine: false, auto: true, body: 'Send 1,200 FCFA to MTN 670 000 000 (The God Nation).' })]);
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: agentWho.id, type: 'PAYMENT_ORDER_NEW' } })).not.toBeNull();
    expect((await agentWho.agent.get('/api/member/pay/me')).body).toEqual({ isAgent: true, waiting: 1 });
    expect((await buyer.agent.get(`/api/member/pay/agents?bookId=${b1.id}`)).body.activeOrder).toMatchObject({ id: opened.body.id, status: 'OPEN' });
  });

  it('opening the same order again returns it; choosing another agent cancels the first', async () => {
    const { a, b1, buyer, agentId } = await setup();
    const second = await member('Second Agent');
    const agent2 = (await send(a, 'post', '/api/admin/payment-agents', { personId: second.id })).body.id as string;
    const one = await openOrder(buyer, agentId, b1.id);
    expect((await openOrder(buyer, agentId, b1.id)).body.id).toBe(one.body.id);
    const two = await openOrder(buyer, agent2, b1.id);
    expect(two.body.id).not.toBe(one.body.id);
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: one.body.id } })).status).toBe('CANCELLED');
  });

  it('only the buyer and the agent can see an order; a switched-off agent cannot be chosen', async () => {
    const { a, b1, buyer, agentId } = await setup();
    const stranger = await member('Stranger');
    const one = await openOrder(buyer, agentId, b1.id);
    expect((await stranger.agent.get(`/api/member/pay/orders/${one.body.id}`)).status).toBe(404);
    expect((await send(stranger, 'post', `/api/member/pay/orders/${one.body.id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await stranger.agent.get('/api/member/pay/desk')).status).toBe(403);
    expect((await send(a, 'patch', `/api/admin/payment-agents/${agentId}`, { active: false })).status).toBe(200);
    expect((await buyer.agent.get(`/api/member/pay/agents?bookId=${b1.id}`)).body.items).toEqual([]);
    expect((await openOrder(buyer, agentId, b1.id)).status).toBe(404);
  });
});

describe('Payment agents: chatting, paying and confirming', () => {
  it('chat both ways, "I have paid", the agent confirms: the book is paid and the inviter earns 500', async () => {
    const { a, b1, buyer, agentWho, agentId } = await setup();
    const grace = await member('Referrer Grace');
    await prisma.friendship.create({ data: { requesterPersonId: grace.id, addresseePersonId: buyer.id, status: 'ACCEPTED', origin: 'REFERRAL', respondedAt: new Date() } });
    const { body: { id } } = await openOrder(buyer, agentId, b1.id);

    expect((await send(buyer, 'post', `/api/member/pay/orders/${id}/messages`, { body: 'I want to pay for Book 1' })).status).toBe(201);
    expect((await send(agentWho, 'post', `/api/member/pay/orders/${id}/messages`, { body: 'Send to 670 000 000' })).status).toBe(201);
    expect((await send(buyer, 'post', `/api/member/pay/orders/${id}/messages`, {})).status).toBe(400);
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: buyer.id, type: 'PAYMENT_ORDER_MESSAGE' } })).not.toBeNull();
    const asAgent = await agentWho.agent.get(`/api/member/pay/orders/${id}`);
    expect(asAgent.body.role).toBe('AGENT');
    expect(asAgent.body.messages.map((m: any) => [m.mine, m.body])).toEqual([[false, 'I want to pay for Book 1'], [true, 'Send to 670 000 000']]);

    // Nothing to decide before the member says they paid.
    expect((await send(agentWho, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' })).status).toBe(409);
    expect((await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'x' })).body.code).toBe('INVALID');
    const paid = await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'MP241028.1111.A11111', payerPhone: '+237 670 000 001' });
    expect(paid.status).toBe(201);
    expect((await buyer.agent.get(`/api/member/pay/orders/${id}`)).body).toMatchObject({ status: 'CLAIMED', canClaim: false, payment: { reference: 'MP241028.1111.A11111', status: 'CLAIMED' } });
    expect((await agentWho.agent.get(`/api/member/pay/orders/${id}`)).body.canDecide).toBe(true);
    // The admin sees the claim in the usual payments list too.
    expect((await a.agent.get('/api/admin/library/payments')).body.items).toEqual([expect.objectContaining({ reference: 'MP241028.1111.A11111', status: 'CLAIMED' })]);
    // The buyer cannot decide their own payment.
    expect((await send(buyer, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' })).status).toBe(403);

    const done = await send(agentWho, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' });
    expect(done.body.status).toBe('CONFIRMED');
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
    const payment = await prisma.bookPayment.findFirstOrThrow({ where: { orderId: id } });
    expect(payment).toMatchObject({ status: 'CONFIRMED', decidedByPersonId: agentWho.id, decidedByUserId: null });
    expect(await prisma.referralEarning.findFirst({ where: { referrerPersonId: grace.id, bookPaymentId: payment.id } })).toMatchObject({ amount: 500 });
    expect(await prisma.notification.findFirst({ where: { recipientPersonId: buyer.id, type: 'BOOK_PAYMENT_CONFIRMED' } })).not.toBeNull();
    const w = (await buyer.agent.get('/api/member/exam-world')).body.training;
    expect(w.books[0].payment).toBe('PAID');
    // Closed: no more messages, and it cannot be decided twice.
    expect((await send(buyer, 'post', `/api/member/pay/orders/${id}/messages`, { body: 'thanks' })).status).toBe(409);
    expect((await send(agentWho, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' })).status).toBe(409);
    expect((await agentWho.agent.get('/api/member/pay/desk')).body).toMatchObject({ confirmedToday: 1, waiting: [] });
  });

  it('a payment the agent cannot find goes back to the member, who can send the right ID; the same ID cannot be reused', async () => {
    const { b1, buyer, agentWho, agentId } = await setup();
    const { body: { id } } = await openOrder(buyer, agentId, b1.id);
    await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'WRONG-ID-1' });
    const no = await send(agentWho, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'REJECT', note: 'The amount was 1,000.' });
    expect(no.body.status).toBe('REJECTED');
    const view = (await buyer.agent.get(`/api/member/pay/orders/${id}`)).body;
    expect(view).toMatchObject({ status: 'OPEN', canClaim: true, payment: { status: 'REJECTED', note: 'The amount was 1,000.' } });
    expect(view.messages.at(-1).body).toContain('The amount was 1,000.');

    const again = await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'RIGHT-ID-2' });
    expect(again.status).toBe(201);
    const stranger = await member('Other Buyer');
    await send(stranger, 'post', '/api/member/training/request');
    const o2 = await openOrder(stranger, agentId, b1.id);
    expect((await send(stranger, 'post', `/api/member/pay/orders/${o2.body.id}/paid`, { reference: 'right-id-2' })).body.code).toBe('DUPLICATE_REFERENCE');
  });

  it('when the admin settles the claim in the payments list, the order follows', async () => {
    const { a, b1, buyer, agentId } = await setup();
    const { body: { id } } = await openOrder(buyer, agentId, b1.id);
    const paid = await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'ADMIN-SETTLES-1' });
    expect((await send(a, 'post', `/api/admin/library/payments/${paid.body.id}`, { decision: 'CONFIRM' })).status).toBe(200);
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
  });

  it('the buyer can cancel an order that is still open, but not one waiting to be confirmed', async () => {
    const { b1, buyer, agentId } = await setup();
    const one = await openOrder(buyer, agentId, b1.id);
    expect((await send(buyer, 'post', `/api/member/pay/orders/${one.body.id}/cancel`)).body.status).toBe('CANCELLED');
    expect((await send(buyer, 'post', `/api/member/pay/orders/${one.body.id}/cancel`)).status).toBe(409);
    const two = await openOrder(buyer, agentId, b1.id);
    await send(buyer, 'post', `/api/member/pay/orders/${two.body.id}/paid`, { reference: 'CANCEL-TEST-1' });
    expect((await send(buyer, 'post', `/api/member/pay/orders/${two.body.id}/cancel`)).status).toBe(409);
    expect((await openOrder(buyer, agentId, b1.id)).body.code).toBe('WAITING');
  });

  it('an agent who reached the daily limit shows as busy and cannot confirm more', async () => {
    const { b1, buyer, agentWho, agentId } = await setup({ dailyLimit: 1 });
    const { body: { id } } = await openOrder(buyer, agentId, b1.id);
    // Another confirmed order today fills the limit.
    const other = await member('Earlier Buyer');
    const b2 = await book(2);
    await prisma.paymentOrder.create({ data: { buyerPersonId: other.id, agentId, bookId: b2.id, bookNumber: 2, amount: 1200, status: 'CONFIRMED', decidedAt: new Date() } });
    expect((await buyer.agent.get(`/api/member/pay/agents?bookId=${b1.id}`)).body.items[0].busy).toBe(true);
    await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'LIMIT-TEST-1' });
    const res = await send(agentWho, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LIMIT');
    const third = await member('Third Buyer');
    await send(third, 'post', '/api/member/training/request');
    expect((await openOrder(third, agentId, b1.id)).body.code).toBe('BUSY');
  });

  it('screenshots: only photos are accepted', async () => {
    const { b1, buyer, agentId } = await setup();
    const { body: { id } } = await openOrder(buyer, agentId, b1.id);
    const bad = await send(buyer, 'post', `/api/member/pay/orders/${id}/proof/authorize`, { mimeType: 'application/pdf', byteSize: 1000 });
    expect(bad.status).toBe(400);
    const forged = await send(buyer, 'post', `/api/member/pay/orders/${id}/messages`, { proof: { storageKey: 'payment-orders/other/proof/x', mimeType: 'image/png', byteSize: 10 } });
    expect(forged.status).toBe(400);
  });
});

describe('Payment agents: the central admin', () => {
  it('sees agents with their numbers, can change them, and sees every order', async () => {
    const { a, b1, buyer, agentWho, agentId } = await setup({ dailyLimit: 5 });
    const { body: { id } } = await openOrder(buyer, agentId, b1.id);
    await send(buyer, 'post', `/api/member/pay/orders/${id}/paid`, { reference: 'ADMIN-VIEW-1' });
    await send(agentWho, 'post', `/api/member/pay/orders/${id}/decide`, { decision: 'CONFIRM' });
    const list = await a.agent.get('/api/admin/payment-agents');
    expect(list.body.items).toEqual([expect.objectContaining({ id: agentId, name: 'Aggie Agent', dailyLimit: 5, active: true, confirmedToday: 1, confirmedTotal: 1, waiting: 0 })]);
    expect((await send(a, 'patch', `/api/admin/payment-agents/${agentId}`, { dailyLimit: 30, label: 'Head office' })).status).toBe(200);
    expect((await a.agent.get('/api/admin/payment-agents')).body.items[0]).toMatchObject({ dailyLimit: 30, label: 'Head office' });
    const orders = await a.agent.get('/api/admin/payment-orders?status=CONFIRMED');
    expect(orders.body.items).toEqual([expect.objectContaining({ id, buyerName: 'Ben Buyer', agentName: 'Aggie Agent', reference: 'ADMIN-VIEW-1', status: 'CONFIRMED' })]);
    const thread = await a.agent.get(`/api/admin/payment-orders/${id}`);
    expect(thread.body.messages.length).toBeGreaterThan(0);
    // Members cannot use the admin routes.
    expect((await buyer.agent.get('/api/admin/payment-agents')).status).toBeGreaterThanOrEqual(401);
  });
});
