import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { growthReport, sourceOf } from '../lib/growthReport';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// The growth report: the funnel by where people came from, and by ambassador.
const app = createApp();
const DAY = 86_400_000;
let n = 0;

async function joiner(opts: {
  utmSource?: string; utmCampaign?: string; fbclid?: string; referralCodeId?: string; daysAgo?: number;
  confirmed?: boolean; completed?: boolean; group?: boolean; chat?: boolean; exam?: boolean; lastSeenDaysAfter?: number; test?: boolean;
}) {
  n += 1;
  const created = new Date(Date.now() - (opts.daysAgo ?? 10) * DAY);
  const person = await prisma.person.create({
    data: {
      name: `Joiner ${n}`, whatsappNumber: `+23767410${String(1000 + n)}`, email: `joiner${n}@example.com`,
      profileCompletedAt: opts.completed ? created : null,
      lastSeenAt: opts.lastSeenDaysAfter !== undefined ? new Date(created.getTime() + opts.lastSeenDaysAfter * DAY) : null,
    },
  });
  if (opts.confirmed) await prisma.memberAccount.create({ data: { personId: person.id, email: `joiner${n}@example.com`, passwordHash: 'x', lastLoginAt: created } });
  const reg = await prisma.registration.create({
    data: {
      visitorId: `v${n}`, normalizedWhatsApp: person.whatsappNumber, name: person.name, createdAt: created, personId: person.id,
      utmSource: opts.utmSource ?? null, utmCampaign: opts.utmCampaign ?? null, fbclid: opts.fbclid ?? null,
      referralCodeId: opts.referralCodeId ?? null, isTestData: opts.test ?? false,
    },
  });
  if (opts.group) await prisma.event.create({ data: { type: 'GROUP_LINK_CLICKED', registrationId: reg.id } });
  if (opts.chat) {
    const community = await prisma.community.create({ data: { name: `G${n}` } });
    const conv = await prisma.conversation.create({ data: { communityId: community.id } });
    await prisma.message.create({ data: { conversationId: conv.id, senderPersonId: person.id, body: 'Hello' } });
  }
  if (opts.exam) {
    const a = await prisma.assessment.create({ data: { titleEn: `Exam ${n}`, passMark: 50, status: 'PUBLISHED' } });
    await prisma.attempt.create({ data: { personId: person.id, assessmentId: a.id, attemptNumber: 1, status: 'SUBMITTED', submittedAt: new Date() } });
  }
  return { person, reg };
}

describe('sourceOf', () => {
  const base = { utmSource: null, utmCampaign: null, fbclid: null, ttclid: null, gclid: null, referrerHost: null, referralCodeId: null };
  it('names the ad source, then the platform behind a click code, then an ambassador link, then the website, else direct', () => {
    expect(sourceOf({ ...base, utmSource: 'TikTok', fbclid: 'x' })).toBe('tiktok');
    expect(sourceOf({ ...base, fbclid: 'x' })).toBe('facebook');
    expect(sourceOf({ ...base, ttclid: 'x' })).toBe('tiktok');
    expect(sourceOf({ ...base, gclid: 'x' })).toBe('google');
    expect(sourceOf({ ...base, referralCodeId: 'c', referrerHost: 'l.facebook.com' })).toBe('ambassador link');
    expect(sourceOf({ ...base, referrerHost: 'google.com' })).toBe('google.com');
    expect(sourceOf(base)).toBe('direct');
  });
});

describe('growthReport: notifications on', () => {
  it('counts members with at least one subscribed phone, out of all members (not test or erased accounts)', async () => {
    const before = (await growthReport(30)).notifications;
    const mk = async (name: string, extra: Record<string, unknown> = {}) => {
      const p = await prisma.person.create({ data: { name, whatsappNumber: `+23767${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`, ...extra } });
      await prisma.memberAccount.create({ data: { personId: p.id, email: `${name.replace(/\s/g, '')}${Math.random()}@example.com`, lastLoginAt: new Date() } });
      return p;
    };
    const two = await mk('Two Phones');
    const one = await mk('One Phone');
    await mk('No Phone');
    const test = await mk('Test Person', { isTestData: true });
    const erased = await mk('Erased Person', { erasedAt: new Date() });
    for (const [p, k] of [[two, 1], [two, 2], [one, 1], [test, 1], [erased, 1]] as const) {
      await prisma.pushSubscription.create({ data: { personId: p.id, endpoint: `https://push.example/n-${p.id}-${k}`, p256dh: 'p', auth: 'a' } });
    }
    const after = (await growthReport(30)).notifications;
    expect(after.totalMembers - before.totalMembers).toBe(3);
    expect(after.membersWithPush - before.membersWithPush).toBe(2);
    expect(after.subscriptions - before.subscriptions).toBe(3);
  });
});

describe('growthReport: tapped a link versus says they joined', () => {
  it('counts a tap and the member’s own "I have joined" separately', async () => {
    const tapOnly = await joiner({ utmSource: 'saysjoinedtest', group: true });
    const said = await joiner({ utmSource: 'saysjoinedtest', group: true });
    await joiner({ utmSource: 'saysjoinedtest' });
    await prisma.memberOnboarding.create({ data: { personId: said.person.id, communityConfirmedAt: new Date() } });
    await prisma.memberOnboarding.create({ data: { personId: tapOnly.person.id } });
    const r = await growthReport(30);
    const row = r.bySource.find((x) => x.source === 'saysjoinedtest')!;
    expect(row).toMatchObject({ registered: 3, joinedGroup: 2, saysJoined: 1 });
  });
});

describe('growthReport', () => {
  it('counts how far each person got, by source and campaign, and by ambassador', async () => {
    const owner = await prisma.person.create({ data: { name: 'Ambassador Ann', whatsappNumber: '+237674099999' } });
    const code = await prisma.referralCode.create({ data: { code: 'ANN1', personId: owner.id } });

    // Facebook ad, campaign "nov": one went all the way, one only signed up.
    await joiner({ utmSource: 'facebook', utmCampaign: 'nov', confirmed: true, completed: true, group: true, chat: true, exam: true, lastSeenDaysAfter: 9 });
    await joiner({ utmSource: 'facebook', utmCampaign: 'nov' });
    // A click code with no utm: counted as facebook, no campaign.
    await joiner({ fbclid: 'abc', confirmed: true });
    // Ambassador link.
    await joiner({ referralCodeId: code.id, confirmed: true, completed: true, lastSeenDaysAfter: 8 });
    // Not counted: test data, and someone outside the window.
    await joiner({ utmSource: 'facebook', utmCampaign: 'nov', test: true });
    await joiner({ utmSource: 'facebook', utmCampaign: 'nov', daysAgo: 60 });

    await prisma.referralVisit.createMany({ data: [
      { visitorId: 'a', utmSource: 'facebook', utmCampaign: 'nov' },
      { visitorId: 'a', utmSource: 'facebook', utmCampaign: 'nov' },
      { visitorId: 'b', utmSource: 'facebook', utmCampaign: 'nov' },
    ] });
    await prisma.lead.create({ data: { name: 'Lead', whatsappNumber: '+237674088888', utmSource: 'facebook', utmCampaign: 'nov' } });

    await prisma.event.createMany({ data: [
      { type: 'GROUP_LINK_CLICKED', detail: 'whatsapp_group_en' },
      { type: 'GROUP_LINK_CLICKED', detail: 'telegram_channel' },
      { type: 'GROUP_LINK_CLICKED', detail: 'telegram_channel' },
    ] });

    const r = await growthReport(30);
    // The joiner above tapped before places were recorded: counted as unknown.
    expect(r.byPlatform[0]).toEqual({ platform: 'telegram_channel', taps: 2 });
    expect(r.byPlatform).toContainEqual({ platform: 'whatsapp_group_en', taps: 1 });
    expect(r.byPlatform).toContainEqual({ platform: 'unknown', taps: 1 });
    expect(r.totals).toMatchObject({ registered: 4, confirmed: 3, profileCompleted: 2, joinedGroup: 1, firstChat: 1, firstExam: 1, returned7: 2, returned30: 0, leads: 1, visitors: 2 });

    const fb = r.bySource.find((x) => x.source === 'facebook' && x.campaign === 'nov')!;
    expect(fb).toMatchObject({ registered: 2, confirmed: 1, profileCompleted: 1, visitors: 2, leads: 1 });
    expect(r.bySource.find((x) => x.source === 'facebook' && x.campaign === null)).toMatchObject({ registered: 1 });
    expect(r.bySource.find((x) => x.source === 'ambassador link')).toMatchObject({ registered: 1, returned7: 1 });

    expect(r.byAmbassador).toEqual([{ name: 'Ambassador Ann', registered: 1, confirmed: 1, profileCompleted: 1, returned7: 1 }]);
  });
});

describe('GET /api/admin/growth', () => {
  it('is for the admin only, and checks the number of days', async () => {
    const anon = request.agent(app);
    expect((await anon.get('/api/admin/growth')).status).toBe(401);

    await createAdmin('growth-admin@test.local', 'AdminPass123!');
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'growth-admin@test.local', password: 'AdminPass123!' });
    const ok = await agent.get('/api/admin/growth?days=7');
    expect(ok.status).toBe(200);
    expect(ok.body.days).toBe(7);
    expect(ok.body.totals).toBeDefined();
    expect((await agent.get('/api/admin/growth?days=0')).status).toBe(400);
  });
});
