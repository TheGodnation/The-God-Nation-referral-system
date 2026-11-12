import { describe, it, expect } from 'vitest';
import { cameroonHour, isCameroonDaytime, nudgeBlock, NUDGE_RULES } from '../lib/nudgeRules';
import { memberStage, spellStart } from '../lib/memberStage';

// The safety rules for every automatic nudge, and the member stages they speak to.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOON = new Date('2026-11-12T09:00:00Z'); // 10:00 in Cameroon
const ago = (ms: number) => new Date(NOON.getTime() - ms);

describe('Cameroon daytime (8:00 to 19:00, UTC+1 all year)', () => {
  it('knows the hour in Cameroon', () => {
    expect(cameroonHour(new Date('2026-11-12T07:00:00Z'))).toBe(8);
    expect(cameroonHour(new Date('2026-11-12T23:30:00Z'))).toBe(0);
  });
  it('allows 8:00 up to (not including) 19:00 and nothing else', () => {
    const at = (utc: string) => isCameroonDaytime(new Date(`2026-11-12T${utc}:00Z`));
    expect(at('06:59')).toBe(false); // 7:59
    expect(at('07:00')).toBe(true); // 8:00
    expect(at('17:59')).toBe(true); // 18:59
    expect(at('18:00')).toBe(false); // 19:00
    expect(at('22:00')).toBe(false);
    expect(at('02:00')).toBe(false);
  });
});

describe('The safety rules', () => {
  const ok = { now: NOON, lastSeenAt: null, sentAts: [] as Date[] };

  it('states them', () => {
    expect(NUDGE_RULES).toMatchObject({ quietAfterSeenHours: 48, minGapDays: 3, maxTotal: 4, stopAfterUnanswered: 3, dayStartHour: 8, dayEndHour: 19 });
  });

  it('lets someone through who was never seen and never nudged', () => {
    expect(nudgeBlock(ok)).toBeNull();
  });

  it('rule 5: not at night, checked at the moment given (and only skipped when asked to just count)', () => {
    const night = new Date('2026-11-12T20:00:00Z');
    expect(nudgeBlock({ ...ok, now: night })).toBe('NIGHT');
    expect(nudgeBlock({ ...ok, now: night, ignoreHours: true })).toBeNull();
  });

  it('rule 1: nothing within 48 hours of being seen', () => {
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(47 * HOUR) })).toBe('RECENTLY_SEEN');
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(49 * HOUR) })).toBeNull();
  });

  it('rule 2: at most one nudge in 3 days, whatever the kind or channel', () => {
    expect(nudgeBlock({ ...ok, sentAts: [ago(2 * DAY)] })).toBe('TOO_SOON');
    expect(nudgeBlock({ ...ok, sentAts: [ago(3 * DAY + HOUR)] })).toBeNull();
  });

  it('rule 3: at most 4 in all', () => {
    const four = [ago(40 * DAY), ago(30 * DAY), ago(20 * DAY), ago(10 * DAY)];
    // They came back after each one, so none is "unanswered": only the total stops it.
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(5 * DAY), sentAts: four })).toBe('LIMIT_REACHED');
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(5 * DAY), sentAts: four.slice(1) })).toBeNull();
  });

  it('rule 4: stops after 3 that were not answered (not seen since), but answered ones do not count', () => {
    const three = [ago(20 * DAY), ago(14 * DAY), ago(8 * DAY)];
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(30 * DAY), sentAts: three })).toBe('UNANSWERED');
    expect(nudgeBlock({ ...ok, lastSeenAt: null, sentAts: three })).toBe('UNANSWERED');
    // Seen after the first two, so only one is unanswered.
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(10 * DAY), sentAts: three })).toBeNull();
  });

  it('gives the first rule that applies, in a fixed order: night, recently seen, limit, unanswered, too soon', () => {
    const night = new Date('2026-11-12T22:00:00Z');
    expect(nudgeBlock({ now: night, lastSeenAt: new Date(night.getTime() - HOUR), sentAts: [new Date(night.getTime() - HOUR)] })).toBe('NIGHT');
    expect(nudgeBlock({ ...ok, lastSeenAt: ago(HOUR), sentAts: [ago(HOUR)] })).toBe('RECENTLY_SEEN');
  });
});

describe('Member stages', () => {
  const base = { createdAt: ago(10 * DAY), lastLoginAt: ago(10 * DAY), profileCompletedAt: ago(10 * DAY), lastSeenAt: null as Date | null };

  it('never signed in, signed in but unfinished, finished but never back, quiet, active', () => {
    expect(memberStage({ ...base, lastLoginAt: null, profileCompletedAt: null }, NOON, 7)).toBe('NOT_CONFIRMED');
    expect(memberStage({ ...base, profileCompletedAt: null }, NOON, 7)).toBe('UNFINISHED');
    expect(memberStage({ ...base, lastSeenAt: null }, NOON, 7)).toBe('NEVER_BACK');
    expect(memberStage({ ...base, lastSeenAt: ago(10 * DAY - 2 * HOUR) }, NOON, 7)).toBe('NEVER_BACK'); // seen only on the first day
    expect(memberStage({ ...base, lastSeenAt: ago(9 * DAY) }, NOON, 7)).toBe('QUIET');
    expect(memberStage({ ...base, lastSeenAt: ago(HOUR) }, NOON, 7)).toBe('ACTIVE');
  });

  it('someone who joined only 2 days ago is not "never back" yet', () => {
    expect(memberStage({ ...base, createdAt: ago(2 * DAY), profileCompletedAt: ago(2 * DAY), lastLoginAt: ago(2 * DAY) }, NOON, 7)).toBe('ACTIVE');
  });

  it('the spell starts at sign-up while unfinished, otherwise when they were last seen', () => {
    expect(spellStart({ ...base, profileCompletedAt: null }, 'UNFINISHED')).toEqual(base.createdAt);
    expect(spellStart({ ...base, lastSeenAt: ago(5 * DAY) }, 'QUIET')).toEqual(ago(5 * DAY));
    expect(spellStart(base, 'NEVER_BACK')).toEqual(base.profileCompletedAt);
  });
});
