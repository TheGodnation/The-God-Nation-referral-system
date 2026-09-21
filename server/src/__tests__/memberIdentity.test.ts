import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

const app = createApp();

// This file makes many magic-link requests and token consumptions, enough
// to exhaust the shared per-IP memberLoginRequestLimiter/
// memberLoginConsumeLimiter budgets if every test shared one source IP
// (see the Phase 3B attemptScoring.test.ts precedent for this exact
// issue). Each test gets its own simulated IP.
let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.71.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function extractToken(link: string): string {
  const url = new URL(link);
  return url.searchParams.get('token')!;
}

async function requestLink(whatsapp: string, email: string) {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/request-link').set('X-CSRF-Token', csrf).send({ whatsapp, email });
  const link = spy.mock.calls[0]?.[0]?.link as string | undefined;
  return { res, agent, csrf, link, sent: spy.mock.calls.length > 0 };
}

describe('Phase 3C — Member identity linking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets an existing Person obtain member access via a magic link', async () => {
    const person = await prisma.person.create({ data: { name: 'Grace Existing', whatsappNumber: '+237670008001' } });
    const { res, link, sent } = await requestLink('+237670008001', 'grace@example.com');

    expect(res.status).toBe(200);
    expect(sent).toBe(true);
    expect(link).toContain('/member/login/confirm?token=');

    const account = await prisma.memberAccount.findUnique({ where: { personId: person.id } });
    expect(account).toBeTruthy();
    expect(account!.email).toBe('grace@example.com');
  });

  it('never creates a Person for an unknown WhatsApp number', async () => {
    const before = await prisma.person.count();
    const { res, sent } = await requestLink('+237670008002', 'nobody@example.com');

    expect(res.status).toBe(200);
    expect(sent).toBe(false);
    const after = await prisma.person.count();
    expect(after).toBe(before);
  });

  it('never creates a MemberAccount for an unknown WhatsApp number', async () => {
    await requestLink('+237670008003', 'nobody2@example.com');
    const accounts = await prisma.memberAccount.count();
    expect(accounts).toBe(0);
  });

  it('never creates or merges a Person based on email alone', async () => {
    // A Person exists with THIS email on file, but a DIFFERENT (unknown)
    // WhatsApp number is requested — email must never be used to find them.
    await prisma.person.create({ data: { name: 'Has Email', whatsappNumber: '+237670008004', email: 'shared@example.com' } });
    const { sent } = await requestLink('+237670008005', 'shared@example.com');
    expect(sent).toBe(false);
    const accounts = await prisma.memberAccount.count();
    expect(accounts).toBe(0);
  });

  it('never gives one Person more than one MemberAccount', async () => {
    const person = await prisma.person.create({ data: { name: 'Repeat Requester', whatsappNumber: '+237670008006' } });
    await requestLink('+237670008006', 'repeat@example.com');
    await requestLink('+237670008006', 'repeat@example.com');
    await requestLink('+237670008006', 'repeat@example.com');

    const accounts = await prisma.memberAccount.findMany({ where: { personId: person.id } });
    expect(accounts).toHaveLength(1);
  });

  it('handles a duplicate email (already owned by another Person) safely, without reassigning it', async () => {
    const personA = await prisma.person.create({ data: { name: 'Person A', whatsappNumber: '+237670008007' } });
    await prisma.person.create({ data: { name: 'Person B', whatsappNumber: '+237670008008' } });

    await requestLink('+237670008007', 'contested@example.com');
    const accountA = await prisma.memberAccount.findUnique({ where: { personId: personA.id } });
    expect(accountA!.email).toBe('contested@example.com');

    // Person B tries to claim the same email — must not reassign it or
    // create a second account bound to it.
    const { sent } = await requestLink('+237670008008', 'contested@example.com');
    expect(sent).toBe(false);

    const stillOwnedByA = await prisma.memberAccount.findUnique({ where: { email: 'contested@example.com' } });
    expect(stillOwnedByA!.personId).toBe(personA.id);
    const totalAccounts = await prisma.memberAccount.count();
    expect(totalAccounts).toBe(1);
  });

  it('does not silently change an existing MemberAccount email to a newly requested one', async () => {
    const person = await prisma.person.create({ data: { name: 'Email Changer', whatsappNumber: '+237670008009' } });
    await requestLink('+237670008009', 'original@example.com');
    const { sent } = await requestLink('+237670008009', 'different@example.com');

    expect(sent).toBe(false);
    const account = await prisma.memberAccount.findUnique({ where: { personId: person.id } });
    expect(account!.email).toBe('original@example.com');
  });

  it('returns an identical generic response for a known and an unknown WhatsApp number', async () => {
    await prisma.person.create({ data: { name: 'Known Person', whatsappNumber: '+237670008010' } });

    const knownAgent = agentWithUniqueIp();
    const { csrf: knownCsrf } = await bootstrap(knownAgent as any);
    const knownRes = await knownAgent
      .post('/api/member/auth/request-link')
      .set('X-CSRF-Token', knownCsrf)
      .send({ whatsapp: '+237670008010', email: 'known@example.com' });

    const unknownAgent = agentWithUniqueIp();
    const { csrf: unknownCsrf } = await bootstrap(unknownAgent as any);
    const unknownRes = await unknownAgent
      .post('/api/member/auth/request-link')
      .set('X-CSRF-Token', unknownCsrf)
      .send({ whatsapp: '+237670008011', email: 'unknown@example.com' });

    expect(knownRes.status).toBe(unknownRes.status);
    expect(knownRes.body).toEqual(unknownRes.body);
    // No sensitive information (person existence, account state) leaks.
    expect(JSON.stringify(knownRes.body)).not.toMatch(/personId|memberAccountId|exists|found/i);
  });
});

describe('Phase 3C — Member login token security', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a cryptographically random token and stores only its hash', async () => {
    await prisma.person.create({ data: { name: 'Token Person', whatsappNumber: '+237670008012' } });
    const { link } = await requestLink('+237670008012', 'token@example.com');
    const rawToken = extractToken(link!);

    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);

    const tokens = await prisma.memberLoginToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).not.toBe(rawToken);
    // The raw token never appears anywhere in the persisted row.
    expect(JSON.stringify(tokens[0])).not.toContain(rawToken);
  });

  it('consumes a valid token exactly once — replay fails', async () => {
    await prisma.person.create({ data: { name: 'Once Person', whatsappNumber: '+237670008013' } });
    const { link } = await requestLink('+237670008013', 'once@example.com');
    const rawToken = extractToken(link!);

    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const first = await anon.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: rawToken });
    expect(first.status).toBe(200);

    const replay = await anon.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: rawToken });
    expect(replay.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    await prisma.person.create({ data: { name: 'Expired Person', whatsappNumber: '+237670008014' } });
    const { link } = await requestLink('+237670008014', 'expired@example.com');
    const rawToken = extractToken(link!);

    await prisma.memberLoginToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const res = await anon.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: rawToken });
    expect(res.status).toBe(400);
  });

  it('rejects a token that never existed, with the same generic failure', async () => {
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const res = await anon
      .post('/api/member/auth/consume')
      .set('X-CSRF-Token', csrf)
      .send({ token: 'a'.repeat(64) });
    expect(res.status).toBe(400);
  });

  it('allows only one winner when the same token is consumed concurrently', async () => {
    await prisma.person.create({ data: { name: 'Concurrent Person', whatsappNumber: '+237670008015' } });
    const { link } = await requestLink('+237670008015', 'concurrent@example.com');
    const rawToken = extractToken(link!);

    const agentA = agentWithUniqueIp();
    const agentB = agentWithUniqueIp();
    const { csrf: csrfA } = await bootstrap(agentA as any);
    const { csrf: csrfB } = await bootstrap(agentB as any);

    const [resA, resB] = await Promise.all([
      agentA.post('/api/member/auth/consume').set('X-CSRF-Token', csrfA).send({ token: rawToken }),
      agentB.post('/api/member/auth/consume').set('X-CSRF-Token', csrfB).send({ token: rawToken }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 400]);

    const sessions = await prisma.memberSession.count();
    expect(sessions).toBe(1);
  });
});

describe('Phase 3C — member login email diagnostic logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the send outcome and Resend message id without ever logging the raw token or login URL', async () => {
    await prisma.person.create({ data: { name: 'Logged Person', whatsappNumber: '+237670008020' } });
    vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true, id: 'test-resend-message-id' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent
      .post('/api/member/auth/request-link')
      .set('X-CSRF-Token', csrf)
      .send({ whatsapp: '+237670008020', email: 'logged@example.com' });

    expect(res.status).toBe(200);

    const diagnosticCall = logSpy.mock.calls.find((call) => call[0] === '[member-auth] login email send attempted');
    expect(diagnosticCall).toBeTruthy();
    expect(diagnosticCall![1]).toMatchObject({ ok: true, skipped: false, resendMessageId: 'test-resend-message-id' });

    // The whole point of this log is to be safe to keep around — verify it
    // never carries the one-time token or the link a member would click.
    const serialized = JSON.stringify(logSpy.mock.calls);
    expect(serialized).not.toContain('/member/login/confirm?token=');
    expect(serialized.toLowerCase()).not.toContain('logged@example.com');
  });

  it('logs a failed send as ok:false with no message id, still returning the generic response', async () => {
    await prisma.person.create({ data: { name: 'Failed Send Person', whatsappNumber: '+237670008021' } });
    vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const res = await agent
      .post('/api/member/auth/request-link')
      .set('X-CSRF-Token', csrf)
      .send({ whatsapp: '+237670008021', email: 'failed@example.com' });

    // The public contract must not change based on email-provider outcome.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'If that WhatsApp number is registered, a sign-in link has been sent to the email you provided.',
    });

    const diagnosticCall = logSpy.mock.calls.find((call) => call[0] === '[member-auth] login email send attempted');
    expect(diagnosticCall).toBeTruthy();
    expect(diagnosticCall![1]).toMatchObject({ ok: false, resendMessageId: null });
  });
});
