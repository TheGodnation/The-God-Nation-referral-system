import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// "My Referrals": a Member's own referral link (ReferralCode.personId,
// alongside the existing Leader-owned ReferralCode.leaderId) and the
// forward-only auto-friend that happens when someone joins the real in-app
// Member signup through it. See schema.prisma's ReferralCode/Registration
// comments.
const app = createApp();

let ipCounter = 30000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.118.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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
  const email = `memberref${n}@example.com`;
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

/** Visits the given referral code, then signs up a brand-new phone/email
 * through the SAME agent (so the visitor cookie carries attribution), and
 * signs in. Returns the new Person's id. */
async function joinThroughLink(ref: string, whatsapp: string, email: string) {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref, lang: 'en' });
  await agent.post('/api/member/auth/signup').set('X-CSRF-Token', csrf).send({ email, whatsapp, password: 'Testpass123', language: 'en' });
  const link = spy.mock.calls[spy.mock.calls.length - 1]?.[0]?.link as string | undefined;
  spy.mockRestore();
  if (link) {
    await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  }
  const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
  return { agent, csrf, personId: person!.id };
}

describe('My Referrals — a Member\'s own link', () => {
  it('lazily creates a referral code on first request, and reuses it afterwards', async () => {
    const a = await member('Link Owner One');
    const first = await a.agent.get('/api/member/referrals/links');
    expect(first.status).toBe(200);
    expect(first.body.referralCode).toBeTruthy();
    expect(first.body.links.en).toContain(`ref=${first.body.referralCode}`);
    expect(first.body.links.fr).toContain(`ref=${first.body.referralCode}`);

    const second = await a.agent.get('/api/member/referrals/links');
    expect(second.body.referralCode).toBe(first.body.referralCode);

    const codeRow = await prisma.referralCode.findUnique({ where: { personId: a.id } });
    expect(codeRow?.code).toBe(first.body.referralCode);
    expect(codeRow?.leaderId).toBeNull();
  });

  it('requires authentication', async () => {
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/member/referrals/links')).status).toBe(401);
    expect((await anon.get('/api/member/referrals/mine')).status).toBe(401);
  });

  it('starts with an empty referrals list', async () => {
    const a = await member('Link Owner Two');
    const res = await a.agent.get('/api/member/referrals/mine');
    expect(res.body.items).toEqual([]);
  });
});

describe('My Referrals — joining through a Member\'s link', () => {
  it('attributes the registration, auto-friends the pair, and lists the new person for the referrer', async () => {
    const referrer = await member('Referrer One');
    const linksRes = await referrer.agent.get('/api/member/referrals/links');
    const code = linksRes.body.referralCode as string;

    const { personId: newPersonId } = await joinThroughLink(code, '+237670200001', 'joiner-one@example.com');

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: '+237670200001' } });
    expect(registration?.referredByPersonId).toBe(referrer.id);

    const friendship = await prisma.friendship.findFirst({
      where: { requesterPersonId: referrer.id, addresseePersonId: newPersonId, status: 'ACCEPTED' },
    });
    expect(friendship).not.toBeNull();
    expect(friendship?.respondedAt).not.toBeNull();

    const mine = await referrer.agent.get('/api/member/referrals/mine');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ personId: newPersonId, name: 'joiner-one@example.com' });
  });

  it('never retroactively friends people who joined before the referrer had a code', async () => {
    const referrer = await member('Referrer Two');
    // A prior, unrelated member exists but was never referred by anyone.
    const bystander = await member('Bystander');
    const friendship = await prisma.friendship.findFirst({
      where: { requesterPersonId: referrer.id, addresseePersonId: bystander.id },
    });
    expect(friendship).toBeNull();
  });

  it('does not attribute or friend when the visited code belongs to a Leader, not a Member', async () => {
    const { user, referralCode: leaderCode } = await createLeader('Referral Leader', 'leader-memref@test.local', 'LMR1CODE');

    const { personId: newPersonId } = await joinThroughLink(leaderCode.code, '+237670200002', 'joiner-two@example.com');

    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: '+237670200002' } });
    expect(registration?.referredByPersonId).toBeNull();
    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId: registration!.id } });
    expect(relationship?.leaderId).toBe(user.id);

    const anyFriendship = await prisma.friendship.findFirst({ where: { addresseePersonId: newPersonId } });
    expect(anyFriendship).toBeNull();
  });

  it('does not crash the Admin referral-visits list when a visit is attributed to a Member\'s code', async () => {
    const referrer = await member('Referrer Three');
    const linksRes = await referrer.agent.get('/api/member/referrals/links');
    const code = linksRes.body.referralCode as string;

    const visitor = agentWithUniqueIp();
    const { csrf } = await bootstrap(visitor as any);
    await visitor.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: code, lang: 'en' });

    const { agent: adminAgent } = await loginAsAdmin('admin-memref-visits@test.local');
    const res = await adminAgent.get('/api/admin/referrals?pageSize=100');
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.visitorId); // just needs to not have thrown
    expect(row).toBeTruthy();
  });
});

describe('My Referrals — who needs a word of encouragement', () => {
  const DAY = 86_400_000;
  let k = 0;
  async function invited(referrerId: string, opts: { confirmed?: boolean; profileDone?: boolean; lastSeenDaysAgo?: number; lang?: 'en' | 'fr' }) {
    k += 1;
    const created = new Date(Date.now() - 30 * DAY);
    const person = await prisma.person.create({
      data: {
        name: `Invited ${k}`, whatsappNumber: `+23767630${String(1000 + k)}`, preferredLanguage: opts.lang ?? 'en',
        profileCompletedAt: opts.profileDone ? created : null,
        lastSeenAt: opts.lastSeenDaysAgo === undefined ? null : new Date(Date.now() - opts.lastSeenDaysAgo * DAY),
      },
    });
    await prisma.memberAccount.create({ data: { personId: person.id, email: `invited${k}@example.com`, passwordHash: 'x', createdAt: created, lastLoginAt: opts.confirmed ? created : null } });
    await prisma.registration.create({ data: { visitorId: `iv${k}`, normalizedWhatsApp: person.whatsappNumber, name: person.name, personId: person.id, referredByPersonId: referrerId, createdAt: created } });
    return person;
  }

  it('says how far each person got, counts them, and keeps phone numbers from an ordinary member', async () => {
    const referrer = await member('Inviter Ann');
    const a = await invited(referrer.id, {});
    const b = await invited(referrer.id, { confirmed: true });
    const c = await invited(referrer.id, { confirmed: true, profileDone: true, lastSeenDaysAgo: 12, lang: 'fr' });
    const d = await invited(referrer.id, { confirmed: true, profileDone: true, lastSeenDaysAgo: 1 });

    const res = await referrer.agent.get('/api/member/referrals/mine?pageSize=50');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.items.map((i: any) => [i.personId, i]));
    expect(byId[a.id].status).toBe('NOT_CONFIRMED');
    expect(byId[b.id].status).toBe('PROFILE_INCOMPLETE');
    expect(byId[c.id]).toMatchObject({ status: 'QUIET', daysQuiet: 12, language: 'fr' });
    expect(byId[d.id].status).toBe('ACTIVE');
    expect(res.body.summary).toEqual({ NOT_CONFIRMED: 1, PROFILE_INCOMPLETE: 1, QUIET: 1, ACTIVE: 1 });
    expect(res.body.canSeeWhatsapp).toBe(false);
    expect(res.body.items.every((i: any) => i.whatsapp === undefined)).toBe(true);
  });

  it('gives a leader the WhatsApp numbers too', async () => {
    const referrer = await member('Inviter Leader');
    await prisma.user.create({ data: { name: 'Inviter Leader', email: 'inviter-leader@test.local', passwordHash: 'x', role: 'LEADER', active: true, personId: referrer.id } });
    const p = await invited(referrer.id, {});
    const res = await referrer.agent.get('/api/member/referrals/mine');
    expect(res.body.canSeeWhatsapp).toBe(true);
    expect(res.body.items.find((i: any) => i.personId === p.id).whatsapp).toBe(p.whatsappNumber);
  });

  it('tells a leader (and only a leader) who has not yet tapped "join our WhatsApp group"', async () => {
    const leader = await member('Inviter Tapper');
    await prisma.user.create({ data: { name: 'Inviter Tapper', email: 'inviter-tapper@test.local', passwordHash: 'x', role: 'LEADER', active: true, personId: leader.id } });
    const tapped = await invited(leader.id, {});
    const tappedOld = await invited(leader.id, {});
    const notYet = await invited(leader.id, {});
    const reg = async (personId: string) => (await prisma.registration.findFirstOrThrow({ where: { personId } })).id;
    await prisma.event.create({ data: { type: 'WHATSAPP_CLICKED', registrationId: await reg(tapped.id) } });
    await prisma.event.create({ data: { type: 'GROUP_LINK_CLICKED', registrationId: await reg(tappedOld.id) } });

    const res = await leader.agent.get('/api/member/referrals/mine?pageSize=50');
    const byId = Object.fromEntries(res.body.items.map((i: any) => [i.personId, i]));
    expect(byId[tapped.id].tappedGroup).toBe(true);
    expect(byId[tappedOld.id].tappedGroup).toBe(true);
    expect(byId[notYet.id].tappedGroup).toBe(false);

    const ordinary = await member('Inviter Plain');
    await invited(ordinary.id, {});
    const plain = await ordinary.agent.get('/api/member/referrals/mine');
    expect(plain.body.items.every((i: any) => i.tappedGroup === undefined)).toBe(true);
  });

  it('uses the admin’s "quiet" days for what counts as quiet', async () => {
    const referrer = await member('Inviter Bob');
    const p = await invited(referrer.id, { confirmed: true, profileDone: true, lastSeenDaysAgo: 5 });
    expect((await referrer.agent.get('/api/member/referrals/mine')).body.items.find((i: any) => i.personId === p.id).status).toBe('ACTIVE');
    await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', reminderQuietDays: 3 }, update: { reminderQuietDays: 3 } });
    const after = await referrer.agent.get('/api/member/referrals/mine');
    expect(after.body.items.find((i: any) => i.personId === p.id).status).toBe('QUIET');
    expect(after.body.quietDays).toBe(3);
  });
});
