import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { FIRST_WEEK, deadlineOf, leadersOverview, remind, sendScheduledReminders, statusFor, weekStartOf } from '../lib/weeklyReports';
import { bootstrap } from './testUtils';

// Weekly reports: a week is Monday to Sunday (Cameroon time), on time by Monday 23:59 after it ends.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;
const at = (iso: string) => new Date(iso);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.154.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Who = Awaited<ReturnType<typeof signedIn>>;
async function signedIn(name: string, kind: 'member' | 'admin' = 'member') {
  n += 1;
  const email = `wk${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377000${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (kind === 'admin') await prisma.user.create({ data: { name: 'Central Admin', email: `wk-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, agent, csrf };
}
const send = (w: Who, method: 'post' | 'put', path: string, body: unknown) => w.agent[method](path).set('X-CSRF-Token', w.csrf).send(body as object);
const community = async (name: string, parentId?: string) => (await prisma.community.create({ data: { name: `${name} ${++n}`, parentId: parentId ?? null } }));
const lead = async (personId: string, communityId: string) => {
  const any = (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.create({ data: { name: 'A', email: `wk-a-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
  await prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: any.id } });
};
const report = (personId: string, weekStart: string, late = false) =>
  prisma.leaderWeeklyReport.create({ data: { personId, weekStart: day(weekStart), contacted: 3, needHelp: 1, late } });
const note = (personId: string, type: 'REPORT_REMINDER' | 'REPORT_LATE') => prisma.notification.count({ where: { recipientPersonId: personId, type } });

afterEach(() => vi.restoreAllMocks());

describe('Weeks and deadlines (Cameroon time)', () => {
  it('a week starts on Monday and the deadline is the next Monday at 23:59', () => {
    expect(weekStartOf(at('2026-11-11T10:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(weekStartOf(at('2026-11-15T22:30:00Z')).toISOString().slice(0, 10)).toBe('2026-11-09'); // Sunday 23:30 locally
    expect(weekStartOf(at('2026-11-15T23:30:00Z')).toISOString().slice(0, 10)).toBe('2026-11-16'); // already Monday 00:30 locally
    expect(deadlineOf(day('2026-11-09')).toISOString()).toBe('2026-11-16T22:59:00.000Z');
  });

  it('colours the report now due: green on time, yellow while open or if late, red when missed, new before the first report', () => {
    const since = at('2026-10-01T00:00:00Z');
    const onTime = [{ weekStart: day('2026-11-09'), late: false }];
    const late = [{ weekStart: day('2026-11-09'), late: true }];
    expect(statusFor(at('2026-11-17T10:00:00Z'), since, onTime).colour).toBe('GREEN');
    expect(statusFor(at('2026-11-17T10:00:00Z'), since, late).colour).toBe('YELLOW');
    expect(statusFor(at('2026-11-16T12:00:00Z'), since, []).colour).toBe('YELLOW'); // Monday, deadline not reached
    expect(statusFor(at('2026-11-16T22:58:00Z'), since, []).colour).toBe('YELLOW'); // Monday 23:58 locally
    expect(statusFor(at('2026-11-16T23:00:00Z'), since, []).colour).toBe('RED'); // Tuesday 00:00 locally
    expect(statusFor(at('2026-11-17T10:00:00Z'), since, []).colour).toBe('RED');
    // Before the first reporting week, or in a leader's first week: nothing is due yet.
    expect(statusFor(at('2026-11-10T10:00:00Z'), since, []).colour).toBe('NEW');
    expect(statusFor(at('2026-11-17T10:00:00Z'), at('2026-11-17T08:00:00Z'), []).colour).toBe('NEW');
    expect(FIRST_WEEK.toISOString().slice(0, 10)).toBe('2026-11-09');
  });

  it('counts missed weeks among the last four', () => {
    const since = at('2026-10-01T00:00:00Z');
    const st = statusFor(at('2026-12-08T10:00:00Z'), since, [{ weekStart: day('2026-11-30'), late: false }]);
    expect(st.colour).toBe('GREEN');
    expect(st.missedOfLast4).toBe(3); // 23 Nov, 16 Nov, 9 Nov missing; 30 Nov sent
  });
});

describe('My leaders and reminders', () => {
  async function leaders() {
    const hq = await community('WkHQ');
    const gen1 = await community('WkGen1', hq.id);
    const gen2 = await community('WkGen2', gen1.id);
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
    const mk = async (name: string, c: { id: string }) => {
      const p = await prisma.person.create({ data: { name: `${name} ${++n}`, whatsappNumber: `+2377100${String(n).padStart(5, '0')}` } });
      await lead(p.id, c.id);
      return p;
    };
    return { gen1, gen2, green: await mk('Green', gen1), red: await mk('Red', gen1), yellow: await mk('Yellow', gen2), plain: await prisma.person.create({ data: { name: `Plain ${++n}`, whatsappNumber: `+2377100${String(++n).padStart(5, '0')}` } }) };
  }
  const now = at('2026-11-17T10:00:00Z'); // Tuesday after the deadline for the week of 9 Nov

  it('shows every leader with a colour, reds first, and filters by generation', async () => {
    const w = await leaders();
    await report(w.green.id, '2026-11-09');
    await report(w.yellow.id, '2026-11-09', true);
    const all = await leadersOverview({}, now);
    const colour = (id: string) => all.leaders.find((l) => l.personId === id)?.colour;
    expect(colour(w.green.id)).toBe('GREEN');
    expect(colour(w.red.id)).toBe('RED');
    expect(colour(w.yellow.id)).toBe('YELLOW');
    expect(all.leaders.find((l) => l.personId === w.plain.id)).toBeUndefined();
    expect(all.leaders.findIndex((l) => l.personId === w.red.id)).toBeLessThan(all.leaders.findIndex((l) => l.personId === w.green.id));
    expect(all.dueWeek).toBe('2026-11-09');
    expect(all.counts.RED).toBeGreaterThanOrEqual(1);
    const g2 = await leadersOverview({ generation: 2 }, now);
    expect(g2.leaders.map((l) => l.personId)).toContain(w.yellow.id);
    expect(g2.leaders.map((l) => l.personId)).not.toContain(w.red.id);
  });

  it('reminds everyone who is late, never someone who reported on time, and chosen leaders on request', async () => {
    const w = await leaders();
    await report(w.green.id, '2026-11-09');
    expect((await remind({ allLate: true }, now)).reminded).toBeGreaterThanOrEqual(1);
    expect(await note(w.red.id, 'REPORT_LATE')).toBe(1);
    expect(await note(w.green.id, 'REPORT_LATE')).toBe(0);
    // Chosen ones: the green one is skipped, the late one is told again.
    await remind({ personIds: [w.green.id, w.red.id] }, now);
    expect(await note(w.green.id, 'REPORT_REMINDER') + (await note(w.green.id, 'REPORT_LATE'))).toBe(0);
    expect(await note(w.red.id, 'REPORT_LATE')).toBe(2);
    // Before the deadline it is a plain reminder.
    await remind({ personIds: [w.red.id] }, at('2026-11-16T10:00:00Z'));
    expect(await note(w.red.id, 'REPORT_REMINDER')).toBe(1);
    // Someone who sent it late owes nothing more.
    await report(w.yellow.id, '2026-11-09', true);
    const before = (await note(w.yellow.id, 'REPORT_LATE')) + (await note(w.yellow.id, 'REPORT_REMINDER'));
    await remind({ personIds: [w.yellow.id] }, now);
    expect((await note(w.yellow.id, 'REPORT_LATE')) + (await note(w.yellow.id, 'REPORT_REMINDER'))).toBe(before);
  });

  it('sends the automatic reminders once: Sunday evening, then the late notice on Tuesday', async () => {
    const w = await leaders();
    await report(w.green.id, '2026-11-09');
    await sendScheduledReminders(at('2026-11-15T17:30:00Z')); // Sunday 18:30 locally
    expect(await note(w.red.id, 'REPORT_REMINDER')).toBe(1);
    expect(await note(w.green.id, 'REPORT_REMINDER')).toBe(0);
    await sendScheduledReminders(at('2026-11-15T20:30:00Z'));
    expect(await note(w.red.id, 'REPORT_REMINDER')).toBe(1); // not twice
    await sendScheduledReminders(at('2026-11-16T09:00:00Z')); // Monday: nothing
    expect(await note(w.red.id, 'REPORT_LATE')).toBe(0);
    await sendScheduledReminders(at('2026-11-17T07:30:00Z')); // Tuesday 08:30 locally
    expect(await note(w.red.id, 'REPORT_LATE')).toBe(1);
    expect(await note(w.green.id, 'REPORT_LATE')).toBe(0);
    await sendScheduledReminders(at('2026-11-17T12:00:00Z'));
    expect(await note(w.red.id, 'REPORT_LATE')).toBe(1);
  });
});

describe('The three doors', () => {
  it('a leader sends and edits their report; only leaders can; bad input and other weeks are refused', async () => {
    const hq = await community('DoorHQ');
    const a = await community('DoorA', hq.id);
    const leader = await signedIn('Leader');
    const plain = await signedIn('Plain');
    await lead(leader.person.id, a.id);
    expect((await plain.agent.get('/api/member/weekly-report/current')).status).toBe(403);
    expect((await send(plain, 'put', '/api/member/weekly-report', { contacted: 1, needHelp: 0 })).status).toBe(403);

    const cur = await leader.agent.get('/api/member/weekly-report/current');
    expect(cur.status).toBe(200);
    expect(cur.body.report).toBeNull();
    expect(cur.body.canEdit).toBe(true);
    expect(cur.body.hint.followedUp).toBe(0);
    expect((await send(leader, 'put', '/api/member/weekly-report', { contacted: -1, needHelp: 0 })).status).toBe(400);
    expect((await send(leader, 'put', '/api/member/weekly-report', { contacted: 'many', needHelp: 0 })).status).toBe(400);
    expect((await send(leader, 'put', '/api/member/weekly-report', { contacted: 1, needHelp: 0, weekStart: '2020-01-06' })).status).toBe(400);

    const saved = await send(leader, 'put', '/api/member/weekly-report', { contacted: 12, needHelp: 3, prayerNeeds: 'Healing for Ada', note: 'A good week' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ contacted: 12, needHelp: 3, prayerNeeds: 'Healing for Ada', weekStart: cur.body.weekStart });
    const edited = await send(leader, 'put', '/api/member/weekly-report', { contacted: 15, needHelp: 3, weekStart: cur.body.weekStart });
    expect(edited.body.contacted).toBe(15);
    expect(await prisma.leaderWeeklyReport.count({ where: { personId: leader.person.id } })).toBe(1);
    const history = await leader.agent.get('/api/member/weekly-report/history');
    expect(history.body.items).toHaveLength(1);
    const cur2 = await leader.agent.get('/api/member/weekly-report/current');
    expect(cur2.body.report.contacted).toBe(15);
  });

  it('the central admin sees every leader and their reports; a leader cannot', async () => {
    const hq = await community('SeeHQ');
    const a = await community('SeeA', hq.id);
    const leader = await signedIn('SeeLeader');
    const admin = await signedIn('SeeAdmin', 'admin');
    await lead(leader.person.id, a.id);
    await send(leader, 'put', '/api/member/weekly-report', { contacted: 4, needHelp: 2, prayerNeeds: 'Peace' });

    expect((await leader.agent.get('/api/member/central-weekly-reports/overview')).status).toBe(403);
    const overview = await admin.agent.get('/api/member/central-weekly-reports/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.leaders.map((l: any) => l.personId)).toContain(leader.person.id);
    const one = await admin.agent.get(`/api/member/central-weekly-reports/leaders/${leader.person.id}`);
    expect(one.body.reports[0]).toMatchObject({ contacted: 4, needHelp: 2, prayerNeeds: 'Peace' });
    expect((await send(admin, 'post', '/api/member/central-weekly-reports/remind', {})).status).toBe(400);
    expect((await send(admin, 'post', '/api/member/central-weekly-reports/remind', { personIds: [leader.person.id] })).status).toBe(200);
    expect((await admin.agent.get('/api/member/central-weekly-reports/summaries')).status).toBe(200);
  });

  it('a representative sees only their generation’s leaders, writes one summary, and the central admin reads it', async () => {
    await prisma.representativeWeeklySummary.deleteMany({});
    const hq = await community('RepHQ');
    const g1 = await community('RepG1', hq.id);
    const g2 = await community('RepG2', g1.id);
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
    const admin = await signedIn('RepAdmin', 'admin');
    const rep = await signedIn('Rep');
    const inGen1 = await signedIn('InGen1');
    const inGen2 = await signedIn('InGen2');
    await lead(rep.person.id, g1.id);
    await lead(inGen1.person.id, g1.id);
    await lead(inGen2.person.id, g2.id);
    const appoint = await send(admin, 'post', '/api/member/central-representatives/appoint', { personId: rep.person.id, generation: 1 });
    expect(appoint.status).toBe(201);
    await send(inGen1, 'put', '/api/member/weekly-report', { contacted: 2, needHelp: 0 });
    await send(inGen2, 'put', '/api/member/weekly-report', { contacted: 5, needHelp: 1 });

    const view = await rep.agent.get('/api/member/rep-weekly-reports/overview');
    expect(view.status).toBe(200);
    const ids = view.body.leaders.map((l: any) => l.personId);
    expect(ids).toContain(inGen1.person.id);
    expect(ids).not.toContain(inGen2.person.id);
    expect((await rep.agent.get(`/api/member/rep-weekly-reports/leaders/${inGen1.person.id}`)).status).toBe(200);
    expect((await rep.agent.get(`/api/member/rep-weekly-reports/leaders/${inGen2.person.id}`)).status).toBe(404);
    expect((await send(rep, 'post', '/api/member/rep-weekly-reports/remind', { personIds: [inGen2.person.id] })).status).toBe(200);
    expect(await note(inGen2.person.id, 'REPORT_LATE') + (await note(inGen2.person.id, 'REPORT_REMINDER'))).toBe(0);

    // Only a representative uses these.
    expect((await inGen1.agent.get('/api/member/rep-weekly-reports/overview')).status).toBe(403);
    const target = await rep.agent.get('/api/member/rep-weekly-reports/summary');
    expect(target.body).toMatchObject({ generation: 1, sent: false, summary: '' });
    expect((await send(rep, 'put', '/api/member/rep-weekly-reports/summary', { summary: ' ' })).status).toBe(400);
    const saved = await send(rep, 'put', '/api/member/rep-weekly-reports/summary', { summary: 'Most leaders are active; two need encouragement.' });
    expect(saved.status).toBe(200);
    expect((await rep.agent.get('/api/member/rep-weekly-reports/summary')).body.sent).toBe(true);
    const seen = await admin.agent.get('/api/member/central-weekly-reports/summaries');
    expect(seen.body.items.find((s: any) => s.generation === 1 && s.summary.startsWith('Most leaders'))).toBeTruthy();
  });

  it('is closed to signed-out visitors', async () => {
    const anon = agentWithIp();
    expect((await anon.get('/api/member/weekly-report/current')).status).toBe(401);
    expect((await anon.get('/api/admin/weekly-reports/overview')).status).toBe(401);
    expect((await anon.get('/api/member/rep-weekly-reports/overview')).status).toBe(401);
  });
});
