// The safety rules every automatic nudge to a member must pass, whatever the channel (reminder emails, phone and in-app
// nudges). They are checked at the moment of sending, with the person's latest facts, never from an earlier list.
//
//  1. Never within 2 days of the person being in the app (they are already with us).
//  2. At most one nudge in 3 days, counting every kind (an email and a nudge are both nudges).
//  3. At most 4 nudges in all for one person.
//  4. Stop after 3 nudges that were not answered (the person did not come back after them).
//  5. Only in the daytime in Cameroon, 8:00 to 19:00 (Cameroon is UTC+1 all year, no summer time).

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const NUDGE_RULES = {
  quietAfterSeenHours: 48,
  minGapDays: 3,
  maxTotal: 4,
  stopAfterUnanswered: 3,
  dayStartHour: 8,
  dayEndHour: 19,
  cameroonUtcOffsetHours: 1,
} as const;

export type NudgeBlock = 'NIGHT' | 'RECENTLY_SEEN' | 'LIMIT_REACHED' | 'UNANSWERED' | 'TOO_SOON';

/** The hour of the day (0-23) in Cameroon. */
export function cameroonHour(now: Date): number {
  return (now.getUTCHours() + NUDGE_RULES.cameroonUtcOffsetHours) % 24;
}

export function isCameroonDaytime(now: Date): boolean {
  const h = cameroonHour(now);
  return h >= NUDGE_RULES.dayStartHour && h < NUDGE_RULES.dayEndHour;
}

export interface NudgeCheck {
  now: Date;
  /** When the person was last in the app (null: never seen). */
  lastSeenAt: Date | null;
  /** When each earlier nudge (of any kind, any channel) was sent to this person. */
  sentAts: Date[];
  /** Skip rule 5 (used only to count who is waiting, never to send). */
  ignoreHours?: boolean;
}

/** Why this person must not be nudged right now, or null when they may be. The first rule that applies is returned. */
export function nudgeBlock({ now, lastSeenAt, sentAts, ignoreHours = false }: NudgeCheck): NudgeBlock | null {
  if (!ignoreHours && !isCameroonDaytime(now)) return 'NIGHT';
  if (lastSeenAt && now.getTime() - lastSeenAt.getTime() < NUDGE_RULES.quietAfterSeenHours * HOUR) return 'RECENTLY_SEEN';
  if (sentAts.length >= NUDGE_RULES.maxTotal) return 'LIMIT_REACHED';
  // Unanswered: sent after the last time they were seen, so they have not come back since.
  const since = lastSeenAt?.getTime() ?? 0;
  if (sentAts.filter((d) => d.getTime() > since).length >= NUDGE_RULES.stopAfterUnanswered) return 'UNANSWERED';
  const latest = sentAts.reduce((m, d) => Math.max(m, d.getTime()), 0);
  if (latest && now.getTime() - latest < NUDGE_RULES.minGapDays * DAY) return 'TOO_SOON';
  return null;
}
