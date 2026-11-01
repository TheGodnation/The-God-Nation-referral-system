import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { allocateTokens, francsFor, perBookCap } from '../lib/tokenSpend';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// King's Token spending (Phase 5c): off until announced; a member pays up to
// 30% of a book with Earned tokens (1 token = 1 franc by default); the tokens
// are held when they say "I have paid", settled when it is confirmed (half to
// the foundation treasury, half burned) and given back when it is rejected.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.159.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const whatsapp = `+2376726${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `tspend${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}
async function admin() {
  n += 1;
  const email = `tspend-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}
const send = (who: { agent: Agent; csrf: string }, method: 'post' | 'put' | 'patch' | 'delete', path: string, body: Record<string, unknown> = {}) =>
  who.agent[method](path).set('X-CSRF-Token', who.csrf).send(body);

let seed = 0;
const giveTokens = (personId: string, amount: number) => {
  seed += 1;
  return prisma.tokenEntry.create({ data: { personId, kind: 'EARNED', reason: 'CLINIC_EXAM', amount, assessmentId: `seed-${seed}`, correctAnswers: 1, ratePerAnswer: 1 } });
};
const turnOn = (extra: Record<string, unknown> = {}) =>
  prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', tokenSpendEnabled: true, ...extra }, update: { tokenSpendEnabled: true, ...extra } });
const earned = async (personId: string) => {
  const sum = await prisma.tokenEntry.aggregate({ where: { personId, kind: 'EARNED' }, _sum: { amount: true } });
  return sum._sum.amount ? sum._sum.amount.toNumber() : 0;
};
const sumWhere = async (where: object) => {
  const sum = await prisma.tokenEntry.aggregate({ where, _sum: { amount: true } });
  return sum._sum.amount ? sum._sum.amount.toNumber() : 0;
};

/** A member who has begun the training (Book 1 is open), with an admin and two training books. */
async function setup(tokens = 500) {
  const a = await admin();
  const b1 = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'Book 1', trainingOrder: 1 } });
  const b2 = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'Book 2', trainingOrder: 2 } });
  const m = await member('Tina Token');
  expect((await send(m, 'post', '/api/member/training/request')).status).toBe(201);
  if (tokens > 0) await giveTokens(m.id, tokens);
  return { a, b1, b2, m };
}
const claim = (m: Who, bookId: string, body: Record<string, unknown> = {}) => send(m, 'post', `/api/member/training/books/${bookId}/payments`, { reference: `MP-${Math.random().toString(36).slice(2, 10)}`, ...body });

afterEach(() => vi.clearAllMocks());

describe('the arithmetic', () => {
  it('30% of 1,200 francs is 360 tokens at 1 franc a token, and 180 at 2 francs a token', () => {
    expect(perBookCap(1200, { valueFcfa: 1, maxPercent: 30 })).toBe(360);
    expect(perBookCap(1200, { valueFcfa: 2, maxPercent: 30 })).toBe(180);
    expect(perBookCap(1200, { valueFcfa: 0, maxPercent: 30 })).toBe(0);
    expect(francsFor(360, 1)).toBe(360);
    expect(francsFor(7, 1.5)).toBe(10);
  });
  it('spreads tokens over books, filling each up to its cap', () => {
    expect(allocateTokens(500, 2, 360)).toEqual([360, 140]);
    expect(allocateTokens(900, 2, 360)).toEqual([360, 360]);
    expect(allocateTokens(0, 3, 360)).toEqual([0, 0, 0]);
  });
});

describe('spending is off until announced', () => {
  it('offers nothing, and refuses to use tokens, while it is switched off', async () => {
    const { b1, m } = await setup(500);
    const q = (await m.agent.get('/api/member/tokens/spend-quote?count=1')).body;
    expect(q).toMatchObject({ enabled: false, maxTokens: 0, balance: 500 });
    const res = await claim(m, b1.id, { useTokens: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOKENS_UNAVAILABLE');
    expect(await prisma.bookPayment.count()).toBe(0);
    expect(await earned(m.id)).toBe(500);
    // Paying the ordinary way still works.
    expect((await claim(m, b1.id)).status).toBe(201);
  });
});

describe('paying part of a book with Earned tokens', () => {
  it('uses up to 30% of the price; the member then pays the rest in cash; confirming burns half and gives half to the foundation', async () => {
    await turnOn();
    const { a, b1, m } = await setup(500);
    const q = (await m.agent.get('/api/member/tokens/spend-quote?count=1')).body;
    expect(q).toMatchObject({ enabled: true, valueFcfa: 1, maxPercent: 30, price: 1200, balance: 500, perBookCap: 360, maxTokens: 360, maxFrancs: 360 });

    const res = await claim(m, b1.id, { useTokens: true });
    expect(res.status).toBe(201);
    const payment = await prisma.bookPayment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(payment).toMatchObject({ amount: 1200, tokensApplied: 360, tokenFrancs: 360, status: 'CLAIMED' });
    // The tokens are held at once.
    expect(await earned(m.id)).toBe(140);

    // The admin sees the cash to expect, and that tokens were used.
    const list = await a.agent.get('/api/admin/library/payments');
    expect(list.body.items[0]).toMatchObject({ amount: 840, tokensApplied: 360 });

    expect((await send(a, 'post', `/api/admin/library/payments/${payment.id}`, { decision: 'CONFIRM' })).body.status).toBe('CONFIRMED');
    expect(await sumWhere({ reason: 'TREASURY_SHARE' })).toBe(180);
    expect(await sumWhere({ kind: 'BURNED' })).toBe(180);
    expect(await earned(m.id)).toBe(140);
    // Deciding again changes nothing.
    expect((await send(a, 'post', `/api/admin/library/payments/${payment.id}`, { decision: 'CONFIRM' })).status).toBe(409);
    expect(await prisma.tokenEntry.count({ where: { reason: 'TREASURY_SHARE' } })).toBe(1);

    // Cash received excludes what tokens covered; the totals show the burn.
    expect((await a.agent.get('/api/admin/library/payments/summary')).body.confirmed).toEqual({ count: 1, amount: 840 });
    const summary = (await a.agent.get('/api/admin/tokens/summary')).body;
    expect(summary).toMatchObject({ burnedTotal: 180, spentTotal: 360 });
    expect(summary.foundationTotal).toBe(180);

    // The member's history shows the spend, and the book it paid toward.
    const view = (await m.agent.get('/api/member/tokens')).body;
    expect(view.balance.earned).toBe(140);
    expect(view.history.find((h: any) => h.reason === 'SPEND_HOLD')).toMatchObject({ amount: -360, bookNumber: 1 });
  });

  it('a rejected payment gives the tokens back', async () => {
    await turnOn();
    const { a, b1, m } = await setup(500);
    const res = await claim(m, b1.id, { useTokens: true });
    expect(await earned(m.id)).toBe(140);
    expect((await send(a, 'post', `/api/admin/library/payments/${res.body.id}`, { decision: 'REJECT' })).body.status).toBe('REJECTED');
    expect(await earned(m.id)).toBe(500);
    expect(await prisma.tokenEntry.count({ where: { reason: 'TREASURY_SHARE' } })).toBe(0);
    expect(await sumWhere({ kind: 'BURNED' })).toBe(0);
    // They can claim again, with the tokens.
    expect((await claim(m, b1.id, { useTokens: true })).status).toBe(201);
    expect(await earned(m.id)).toBe(140);
  });

  it('uses only the tokens the member has, and never more than the limit', async () => {
    await turnOn();
    const { b1, m } = await setup(100);
    const res = await claim(m, b1.id, { useTokens: true });
    expect(res.status).toBe(201);
    expect(await prisma.bookPayment.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ tokensApplied: 100, tokenFrancs: 100 });
    expect(await earned(m.id)).toBe(0);
    // No tokens left: asking to use tokens is refused.
    const other = await member('Other Person');
    await send(other, 'post', '/api/member/training/request');
    const again = await claim(other, b1.id, { useTokens: true });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TOKENS_UNAVAILABLE');
  });

  it('follows the admin\'s rate and limit', async () => {
    await turnOn({ tokenValueFcfa: 2, tokenSpendMaxPercent: 50 });
    const { b1, m } = await setup(1000);
    expect((await m.agent.get('/api/member/tokens/spend-quote?count=1')).body).toMatchObject({ valueFcfa: 2, maxPercent: 50, perBookCap: 300, maxTokens: 300, maxFrancs: 600 });
    const res = await claim(m, b1.id, { useTokens: true });
    // 50% of 1,200 = 600 francs = 300 tokens at 2 francs a token.
    expect(await prisma.bookPayment.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ tokensApplied: 300, tokenFrancs: 600 });
    expect(await earned(m.id)).toBe(700);
  });

  it('a payment for two books spreads the tokens over them, and each book settles with its payment', async () => {
    await turnOn();
    const { a, m } = await setup(500);
    const res = await send(m, 'post', '/api/member/training/payments', { count: 2, reference: 'BATCH-TOKENS-1', useTokens: true });
    expect(res.status).toBe(201);
    const rows = await prisma.bookPayment.findMany({ where: { personId: m.id }, orderBy: { bookNumber: 'asc' } });
    expect(rows.map((r) => [r.tokensApplied, r.tokenFrancs])).toEqual([[360, 360], [140, 140]]);
    expect(await earned(m.id)).toBe(0);
    const list = await a.agent.get('/api/admin/library/payments');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ bookCount: 2, amount: 1900, tokensApplied: 500 });
    await send(a, 'post', `/api/admin/library/payments/${rows[0].id}`, { decision: 'CONFIRM' });
    expect(await sumWhere({ kind: 'BURNED' })).toBe(250);
    expect(await sumWhere({ reason: 'TREASURY_SHARE' })).toBe(250);
  });

  it('two claims cannot spend the same tokens', async () => {
    await turnOn();
    const { b1, b2, m } = await setup(400);
    // Book 1 uses 360; only 40 remain for what follows.
    expect((await claim(m, b1.id, { useTokens: true })).status).toBe(201);
    const second = await send(m, 'post', '/api/member/training/payments', { count: 1, reference: 'SECOND-ONE-1', useTokens: true });
    expect(second.status).toBe(201);
    expect(await prisma.bookPayment.findFirstOrThrow({ where: { personId: m.id, bookNumber: 2 } })).toMatchObject({ tokensApplied: 40 });
    expect(await earned(m.id)).toBe(0);
    // Nothing is left, so a third try with tokens is refused.
    expect((await send(m, 'post', '/api/member/training/payments', { count: 1, reference: 'THIRD-ONE-1', useTokens: true })).status).toBe(409);
    void b2;
  });

  it('a claim replaced by a payment the admin recorded releases its tokens on the next look', async () => {
    await turnOn();
    const { a, b1, m } = await setup(500);
    await claim(m, b1.id, { useTokens: true });
    expect(await earned(m.id)).toBe(140);
    const recorded = await send(a, 'post', '/api/admin/library/payments', { personId: m.id, bookId: b1.id, reference: 'CASH' });
    expect(recorded.status).toBeLessThan(300);
    const view = (await m.agent.get('/api/member/tokens')).body;
    expect(view.balance.earned).toBe(500);
  });
});

describe('the central admin controls spending', () => {
  it('switches spending on, sets the rate and the limit, and checks them', async () => {
    const a = await admin();
    expect((await a.agent.get('/api/admin/tokens/summary')).body.spend).toEqual({ enabled: false, valueFcfa: 1, maxPercent: 30 });
    expect((await send(a, 'put', '/api/admin/tokens/spend-settings', { enabled: true, valueFcfa: 0, maxPercent: 30 })).status).toBe(400);
    expect((await send(a, 'put', '/api/admin/tokens/spend-settings', { enabled: true, valueFcfa: 1, maxPercent: 150 })).status).toBe(400);
    const ok = await send(a, 'put', '/api/admin/tokens/spend-settings', { enabled: true, valueFcfa: 1, maxPercent: 30 });
    expect(ok.status).toBe(200);
    expect(ok.body.spend).toEqual({ enabled: true, valueFcfa: 1, maxPercent: 30 });
    expect(await prisma.auditLog.count({ where: { action: 'TOKEN_SPEND_SETTINGS_UPDATED' } })).toBe(1);
    const m = await member('Ordinary Member');
    expect((await send(m, 'put', '/api/member/central-tokens/spend-settings', { enabled: false, valueFcfa: 1, maxPercent: 30 })).status).toBe(403);
    expect((await m.agent.get('/api/member/tokens')).body.usable).toBe(true);
  });
});

describe('paying through an online representative', () => {
  it('shows the cash to pay, holds the tokens when the member says they paid, and settles when the agent confirms', async () => {
    await turnOn();
    const { a, b1, m } = await setup(500);
    const agentWho = await member('Aggie Agent');
    const created = await send(a, 'post', '/api/admin/payment-agents', { personId: agentWho.id, label: 'Douala office' });
    expect(created.status).toBe(201);
    const order = await send(m, 'post', '/api/member/pay/orders', { agentId: created.body.id, bookId: b1.id, useTokens: true });
    expect(order.status).toBeLessThan(300);
    const detail = (await m.agent.get(`/api/member/pay/orders/${order.body.id}`)).body;
    expect(detail).toMatchObject({ amount: 840, tokensApplied: 360, tokenFrancs: 360 });
    // Not held yet: only when they say they have paid.
    expect(await earned(m.id)).toBe(500);

    expect((await send(m, 'post', `/api/member/pay/orders/${order.body.id}/paid`, { reference: 'AGENT-PAY-1' })).status).toBe(201);
    expect(await earned(m.id)).toBe(140);
    const desk = (await agentWho.agent.get('/api/member/pay/desk')).body;
    expect(desk.waiting[0]).toMatchObject({ amount: 840, tokensApplied: 360 });

    expect((await send(agentWho, 'post', `/api/member/pay/orders/${order.body.id}/decide`, { decision: 'CONFIRM' })).body.status).toBe('CONFIRMED');
    expect(await sumWhere({ kind: 'BURNED' })).toBe(180);
    expect(await sumWhere({ reason: 'TREASURY_SHARE' })).toBe(180);
  });

  it('refuses the order when the tokens are not there any more', async () => {
    await turnOn();
    const { a, b1, m } = await setup(500);
    const agentWho = await member('Aggie Agent');
    const created = await send(a, 'post', '/api/admin/payment-agents', { personId: agentWho.id, label: 'Douala office' });
    const order = await send(m, 'post', '/api/member/pay/orders', { agentId: created.body.id, bookId: b1.id, useTokens: true });
    await prisma.tokenEntry.deleteMany({ where: { personId: m.id } }); // the tokens vanish before they claim
    const res = await send(m, 'post', `/api/member/pay/orders/${order.body.id}/paid`, { reference: 'AGENT-PAY-2' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOKENS_GONE');
    expect(await prisma.bookPayment.count()).toBe(0);
  });
});
