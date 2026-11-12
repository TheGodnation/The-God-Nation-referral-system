import { describe, it, expect, vi, afterEach } from 'vitest';
// Lets one test make the next nudge fail (a spy on the database client cannot be undone, so the failure is injected here).
const inject = vi.hoisted(() => ({ failNext: false }));
vi.mock('../lib/notifications', async (orig) => {
  const m = await orig<typeof import('../lib/notifications')>();
  return {
    ...m,
    notifyMemberNudge: (...args: Parameters<typeof m.notifyMemberNudge>) => {
      if (inject.failNext) {
        inject.failNext = false;
        return Promise.reject(new Error('database blip'));
      }
      return m.notifyMemberNudge(...args);
    },
  };
});

import { prisma } from '../lib/prisma';
import { nudgePending, nudgeStats, nudgeText, processMemberNudges } from '../lib/memberNudges';

// Phone and in-app nudges at 3 and 7 days: who gets one, in what words, and when they must not.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOON = new Date('2026-11-12T09:00:00Z'); // 10:00 in Cameroon
const NIGHT = new Date('2026-11-12T21:00:00Z');
const ago = (ms: number, from = NOON) => new Date(from.getTime() - ms);
let n = 0;

async function setSettings(data: Record<string, unknown>) {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
}

async function member(o: { joinedAgo: number; signedIn?: boolean; profileDone?: boolean; seenAgo?: number | null; lang?: 'en' | 'fr'; test?: boolean; erased?: boolean }) {
  n += 1;
  const created = ago(o.joinedAgo);
  const person = await prisma.person.create({
    data: {
      name: `Nudge ${n}`, whatsappNumber: `+23769${String(3000000 + n)}`, preferredLanguage: o.lang ?? 'en', isTestData: o.test ?? false, erasedAt: o.erased ? NOON : null,
      profileCompletedAt: o.profileDone ? created : null,
      lastSeenAt: o.seenAgo === undefined || o.seenAgo === null ? null : ago(o.seenAgo),
    },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email: `nudge${n}@example.com`, passwordHash: 'x', createdAt: created, lastLoginAt: o.signedIn === false ? null : created } });
  return person;
}
const ledger = (personId: string, kind: 'NUDGE_DAY3' | 'NUDGE_DAY7' | 'WINBACK' | 'FINISH_PROFILE', sentAgo: number) => prisma.memberReminder.create({ data: { personId, kind, sentAt: ago(sentAgo) } });
const nudgesOf = (personId: string) => prisma.notification.findMany({ where: { recipientPersonId: personId, type: 'MEMBER_NUDGE' } });

afterEach(() => vi.restoreAllMocks());

describe('The words', () => {
  it('are warm, short, in the reader’s language, with no price or link to pay', () => {
    for (const stage of ['unfinished', 'return'] as const) {
      for (const day of [3, 7] as const) {
        for (const french of [false, true]) {
          const t = nudgeText(stage, day, french);
          expect(t.title.length).toBeGreaterThan(5);
          expect(t.body.length).toBeGreaterThan(20);
          expect(`${t.title} ${t.body}`).not.toMatch(/https?:|www\.|FCFA|\$|€|price|pay/i);
          expect(t.url).toBe(stage === 'unfinished' ? '/member/complete-profile' : '/member/chats');
        }
      }
    }
    expect(nudgeText('return', 7, true).title).toBe('Vous nous manquez');
    expect(nudgeText('unfinished', 3, false).title).toBe('Your registration is almost done');
  });
});

describe('Nudges at 3 and 7 days', () => {
  it('send nothing while switched off (the default), and nothing at night', async () => {
    await member({ joinedAgo: 4 * DAY });
    expect(await processMemberNudges(NOON)).toMatchObject({ sent: {}, reason: 'off' });
    await setSettings({ nudgesEnabled: true });
    expect(await processMemberNudges(NIGHT)).toMatchObject({ sent: {}, reason: 'night' });
  });

  it('day 3: someone who signed in but did not finish gets one, once, in their language, and it is written in the ledger', async () => {
    await setSettings({ nudgesEnabled: true });
    const fr = await member({ joinedAgo: 4 * DAY, lang: 'fr' });
    const en = await member({ joinedAgo: 4 * DAY, lang: 'en' });
    const r = await processMemberNudges(NOON);
    expect(r.sent.NUDGE_DAY3).toBeGreaterThanOrEqual(2);
    for (const p of [fr, en]) {
      const rows = await nudgesOf(p.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({ stage: 'unfinished', day: 3, url: '/member/complete-profile' });
      expect(await prisma.memberReminder.count({ where: { personId: p.id, kind: 'NUDGE_DAY3' } })).toBe(1);
    }
    // Running again changes nothing for them (one nudge in 3 days, and the day-3 one is done).
    await processMemberNudges(new Date(NOON.getTime() + HOUR));
    expect(await nudgesOf(en.id)).toHaveLength(1);
  });

  it('is not sent before day 3, nor to someone who never signed in, nor to test or erased accounts', async () => {
    await setSettings({ nudgesEnabled: true });
    const young = await member({ joinedAgo: 2 * DAY });
    const never = await member({ joinedAgo: 5 * DAY, signedIn: false });
    const test = await member({ joinedAgo: 5 * DAY, test: true });
    const erased = await member({ joinedAgo: 5 * DAY, erased: true });
    await processMemberNudges(NOON);
    for (const p of [young, never, test, erased]) expect(await nudgesOf(p.id)).toHaveLength(0);
  });

  it('day 7 follows day 3 after the gap; before the gap nothing is sent', async () => {
    await setSettings({ nudgesEnabled: true });
    const ready = await member({ joinedAgo: 8 * DAY });
    await ledger(ready.id, 'NUDGE_DAY3', 4 * DAY);
    const tooSoon = await member({ joinedAgo: 8 * DAY });
    await ledger(tooSoon.id, 'NUDGE_DAY3', 1 * DAY);
    await processMemberNudges(NOON);
    expect(await prisma.memberReminder.count({ where: { personId: ready.id, kind: 'NUDGE_DAY7' } })).toBe(1);
    expect((await nudgesOf(ready.id))[0].metadata).toMatchObject({ day: 7 });
    expect(await prisma.memberReminder.count({ where: { personId: tooSoon.id, kind: 'NUDGE_DAY7' } })).toBe(0);
  });

  it('speaks to people who finished but never came back, or went quiet, with the "return" words', async () => {
    await setSettings({ nudgesEnabled: true });
    const never = await member({ joinedAgo: 5 * DAY, profileDone: true, seenAgo: null });
    const quiet = await member({ joinedAgo: 40 * DAY, profileDone: true, seenAgo: 9 * DAY });
    await processMemberNudges(NOON);
    expect((await nudgesOf(never.id))[0].metadata).toMatchObject({ stage: 'return', day: 3, url: '/member/chats' });
    expect((await nudgesOf(quiet.id))[0].metadata).toMatchObject({ stage: 'return', day: 3 });
  });

  it('never breaks the safety rules: recently seen, 4 in all, 3 unanswered, a reminder email just sent', async () => {
    await setSettings({ nudgesEnabled: true });
    const seen = await member({ joinedAgo: 20 * DAY, profileDone: true, seenAgo: 30 * HOUR }); // was in the app yesterday
    const limit = await member({ joinedAgo: 200 * DAY, profileDone: true, seenAgo: 20 * DAY });
    for (const d of [100, 80, 60, 40]) await ledger(limit.id, 'WINBACK', d * DAY);
    const unanswered = await member({ joinedAgo: 60 * DAY, profileDone: true, seenAgo: 30 * DAY });
    for (const d of [25, 18, 12]) await ledger(unanswered.id, 'WINBACK', d * DAY);
    const emailed = await member({ joinedAgo: 6 * DAY });
    await ledger(emailed.id, 'FINISH_PROFILE', 1 * DAY); // an email counts as a nudge
    await processMemberNudges(NOON);
    for (const p of [seen, limit, unanswered, emailed]) expect(await nudgesOf(p.id)).toHaveLength(0);
  });

  it('gives the claim back when the nudge cannot be made, so it is tried again later', async () => {
    await setSettings({ nudgesEnabled: true });
    const p = await member({ joinedAgo: 4 * DAY });
    inject.failNext = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await processMemberNudges(NOON);
    expect(await prisma.memberReminder.count({ where: { personId: p.id, kind: 'NUDGE_DAY3' } })).toBe(0);
    await processMemberNudges(new Date(NOON.getTime() + HOUR));
    expect(await prisma.memberReminder.count({ where: { personId: p.id, kind: 'NUDGE_DAY3' } })).toBe(1);
  });

  it('a person who comes back starts a new spell and is nudged afresh later', async () => {
    await setSettings({ nudgesEnabled: true });
    const p = await member({ joinedAgo: 60 * DAY, profileDone: true, seenAgo: 8 * DAY });
    await ledger(p.id, 'NUDGE_DAY3', 50 * DAY); // an old nudge, from before they were last seen: a different spell
    await processMemberNudges(NOON);
    expect(await prisma.memberReminder.count({ where: { personId: p.id, kind: 'NUDGE_DAY3' } })).toBe(2);
  });

  it('counts who is waiting (ignoring only the hour) and what was sent, for the admin', async () => {
    const before = await nudgePending(NIGHT);
    const p = await member({ joinedAgo: 4 * DAY });
    const after = await nudgePending(NIGHT);
    expect(after.NUDGE_DAY3 - before.NUDGE_DAY3).toBe(1);
    await setSettings({ nudgesEnabled: true });
    const stats0 = await nudgeStats(NOON);
    await processMemberNudges(NOON);
    const stats1 = await nudgeStats(new Date(NOON.getTime() + HOUR));
    expect(stats1.last7.NUDGE_DAY3).toBeGreaterThan(stats0.last7.NUDGE_DAY3);
    expect(stats1.sentToday).toBeGreaterThan(0);
    expect(await nudgesOf(p.id)).toHaveLength(1);
  });
});
