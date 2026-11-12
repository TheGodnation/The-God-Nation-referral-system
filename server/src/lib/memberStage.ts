// Where a member is on their way, in one place, so every nudge speaks to the stage the person is really at.
//  NOT_CONFIRMED: registered but never signed in (no phone alert or bell can reach them; only email does).
//  UNFINISHED:    signed in, but has not given their details yet (so is in no assembly).
//  NEVER_BACK:    finished, joined at least 3 days ago, and not seen again after their first day.
//  QUIET:         finished, but not seen for the "quiet" number of days.
//  ACTIVE:        everyone else.

const DAY = 24 * 60 * 60 * 1000;
const NEVER_BACK_AFTER_DAYS = 3;

export type MemberStage = 'NOT_CONFIRMED' | 'UNFINISHED' | 'NEVER_BACK' | 'QUIET' | 'ACTIVE';

export interface StageFacts {
  /** When the account was made. */
  createdAt: Date;
  lastLoginAt: Date | null;
  profileCompletedAt: Date | null;
  lastSeenAt: Date | null;
}

export function memberStage(f: StageFacts, now: Date, quietDays: number): MemberStage {
  if (!f.lastLoginAt) return 'NOT_CONFIRMED';
  if (!f.profileCompletedAt) return 'UNFINISHED';
  if (now.getTime() - f.createdAt.getTime() > NEVER_BACK_AFTER_DAYS * DAY && (!f.lastSeenAt || f.lastSeenAt.getTime() - f.createdAt.getTime() < DAY)) return 'NEVER_BACK';
  const seen = f.lastSeenAt ?? f.profileCompletedAt;
  return seen.getTime() < now.getTime() - quietDays * DAY ? 'QUIET' : 'ACTIVE';
}

/** The moment the current "spell" began: when they signed up (unfinished), else when they were last seen. A new spell starts when they come back. */
export function spellStart(f: StageFacts, stage: MemberStage): Date {
  if (stage === 'UNFINISHED') return f.createdAt;
  return f.lastSeenAt ?? f.profileCompletedAt ?? f.createdAt;
}
