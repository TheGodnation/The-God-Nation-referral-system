import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// The first referral system, per leader: link clicks, sign-ups, taps on "join the WhatsApp group", people now in the
// app and in an assembly — for the central admin only, with a spreadsheet.
const app = createApp();
let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.159.0.${ip}`);
  return wrapped;
}
let n = 0;

async function leader(name: string, extra: Record<string, unknown> = {}) {
  n += 1;
  const user = await prisma.user.create({ data: { name, email: `rep-leader${n}@test.local`, passwordHash: 'x', role: 'LEADER', active: true, ...extra } });
  const code = await prisma.referralCode.create({ data: { code: `REP${n}X`, leaderId: user.id } });
  return { user, code };
}
async function visit(codeId: string, visitorId: string) {
  return prisma.referralVisit.create({ data: { visitorId, referralCodeId: codeId } });
}
async function signUp(l: { user: { id: string }; code: { id: string } }, name: string, opts: { tapped?: boolean | 'group'; inApp?: boolean; assembly?: string; test?: boolean } = {}) {
  n += 1;
  const person = opts.inApp
    ? await prisma.person.create({ data: { name, whatsappNumber: `+2376654${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } })
    : null;
  if (person) await prisma.memberAccount.create({ data: { personId: person.id, email: `rep${n}@example.com` } });
  if (person && opts.assembly) await prisma.communityMembership.create({ data: { personId: person.id, communityId: opts.assembly, status: 'ACTIVE' } });
  const registration = await prisma.registration.create({
    data: { visitorId: `v-sign-${n}`, normalizedWhatsApp: `+2376655${String(n).padStart(5, '0')}`, name, referralCodeId: l.code.id, personId: person?.id ?? null, isTestData: Boolean(opts.test) },
  });
  await prisma.referralRelationship.create({ data: { leaderId: l.user.id, registrationId: registration.id, referralCodeId: l.code.id } });
  if (opts.tapped) await prisma.event.create({ data: { type: opts.tapped === 'group' ? 'GROUP_LINK_CLICKED' : 'WHATSAPP_CLICKED', registrationId: registration.id } });
  return registration;
}

async function adminAgent() {
  const admin = await createAdmin(`rep-admin${++n}@test.local`, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: admin.email, password: 'AdminPass123!' });
  return { admin, agent, csrf };
}

describe('the leaders\' referral report (first referral system)', () => {
  it('counts, for each leader, link clicks, different visitors, sign-ups, taps on the group, and people now in the app and an assembly', async () => {
    const a = await adminAgent();
    const assembly = await prisma.community.create({ data: { name: `Report Assembly ${n}` } });
    const anna = await leader('Anna');
    const ben = await leader('Ben');
    const quiet = await leader('Quiet One');

    // Anna: 5 clicks from 3 different people; 3 signed up; 2 tapped the group (one on each kind of button); 2 are now in the app; 1 is in an assembly.
    for (const v of ['v1', 'v1', 'v2', 'v3', 'v3']) await visit(anna.code.id, v);
    await signUp(anna, 'Sign One', { tapped: true, inApp: true, assembly: assembly.id });
    await signUp(anna, 'Sign Two', { tapped: 'group', inApp: true });
    await signUp(anna, 'Sign Three');
    // Ben: one click, one sign-up, nothing else. A test sign-up is left out.
    await visit(ben.code.id, 'v9');
    await signUp(ben, 'Ben Sign');
    await signUp(ben, 'Test Sign', { test: true });

    const res = await a.agent.get('/api/admin/leader-referral-report');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.rows.map((r: any) => [r.name, r]));
    expect(by['Anna']).toMatchObject({ visits: 5, uniqueVisitors: 3, referred: 3, tappedGroup: 2, inApp: 2, inAssembly: 1, conversionRate: 100, active: true });
    expect(by['Anna'].codes).toEqual([anna.code.code]);
    expect(by['Ben']).toMatchObject({ visits: 1, uniqueVisitors: 1, referred: 1, tappedGroup: 0, inApp: 0, inAssembly: 0 });
    expect(by['Quiet One']).toMatchObject({ visits: 0, referred: 0, conversionRate: 0 });
    // Most sign-ups first; everyone is listed, even a leader with none.
    expect(res.body.rows.map((r: any) => r.name)).toEqual(['Anna', 'Ben', 'Quiet One']);
    expect(res.body.totals).toMatchObject({ visits: 6, uniqueVisitors: 4, referred: 4, tappedGroup: 2, inApp: 2, inAssembly: 1 });

    const withTest = (await a.agent.get('/api/admin/leader-referral-report?includeTestData=true')).body;
    expect(withTest.rows.find((r: any) => r.name === 'Ben').referred).toBe(2);
  });

  it('includes a leader who has been turned off, and leaves test leaders out unless asked', async () => {
    const a = await adminAgent();
    await leader('Turned Off', { active: false });
    await leader('Test Leader', { isTestData: true });
    const res = (await a.agent.get('/api/admin/leader-referral-report')).body;
    expect(res.rows.map((r: any) => [r.name, r.active])).toEqual([['Turned Off', false]]);
    expect((await a.agent.get('/api/admin/leader-referral-report?includeTestData=true')).body.rows).toHaveLength(2);
  });

  it('downloads a spreadsheet with a total row, and keeps the report for the central admin only', async () => {
    const a = await adminAgent();
    const anna = await leader('Anna');
    await visit(anna.code.id, 'v1');
    await signUp(anna, 'Sign One', { tapped: true });
    const csv = await a.agent.get('/api/admin/leader-referral-report/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Leader,Email,Account,Link code(s),Link clicks');
    expect(csv.text).toContain('Anna,');
    expect(csv.text).toContain('TOTAL');
    expect(await prisma.auditLog.count({ where: { action: 'LEADER_REFERRAL_REPORT_EXPORTED' } })).toBe(1);

    // A leader's own member session cannot read it; nor can a visitor.
    n += 1;
    const person = await prisma.person.create({ data: { name: 'Plain Leader', whatsappNumber: `+2376656${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
    const email = `repm${n}@example.com`;
    await prisma.memberAccount.create({ data: { personId: person.id, email } });
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const m = agentWithUniqueIp();
    const { csrf } = await bootstrap(m as any);
    await m.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
    const code = spy.mock.calls[0][0].code as string;
    spy.mockRestore();
    await m.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    expect((await m.get('/api/member/central-leader-referral-report')).status).toBe(403);
    expect((await agentWithUniqueIp().get('/api/admin/leader-referral-report')).status).toBe(401);

    // The central admin's member profile reads the same report.
    await prisma.user.update({ where: { id: a.admin.id }, data: { personId: person.id } });
    const own = await m.get('/api/member/central-leader-referral-report');
    expect(own.status).toBe(200);
    expect(own.body.rows[0].name).toBe('Anna');
  });
});
