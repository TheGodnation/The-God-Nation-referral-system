import type { ReminderKind } from '@prisma/client';
import { prisma } from './prisma';
import { notifyMemberNudge } from './notifications';
import { memberStage, spellStart, type MemberStage } from './memberStage';
import { isCameroonDaytime, nudgeBlock } from './nudgeRules';

// Phone and in-app nudges at 3 and 7 days, for people who signed in but are not yet really with us:
//  - "unfinished": signed in and did not give their details (so they are in no assembly): 3 and 7 days after signing up;
//  - "return": finished but never came back, or gone quiet: 3 and 7 days after they were last in the app.
// Each person gets at most one of each kind per spell (a new spell starts when they come back), and always passes the safety
// rules in lib/nudgeRules.ts, checked at the moment of sending. Off until the central admin switches it on.
// Every nudge is written in the same ledger as the reminder emails (MemberReminder), so the limits count both.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
export type NudgeKind = Extract<ReminderKind, 'NUDGE_DAY3' | 'NUDGE_DAY7'>;
export const NUDGE_KINDS: NudgeKind[] = ['NUDGE_DAY3', 'NUDGE_DAY7'];
type Stage = 'unfinished' | 'return';

/** How many people one run may nudge, and how many members it looks at. */
const PER_RUN = 150;
const SCAN = 4000;

const baseWhere = { erasedAt: null, deletionRequestedAt: null, isTestData: false };

export function nudgeText(stage: Stage, day: 3 | 7, french: boolean): { title: string; body: string; url: string } {
  const url = stage === 'unfinished' ? '/member/complete-profile' : '/member/chats';
  const en = {
    'unfinished-3': ['Your registration is almost done', 'Finish your details to join your assembly. It takes about one minute.'],
    'unfinished-7': ['We saved your place', 'Come back and finish your details so we can place you in your assembly. We are here to help.'],
    'return-3': ['A teaching is waiting for you', 'Open the app to see what is new in your assembly.'],
    'return-7': ['We miss you', 'Your brothers and sisters are asking about you. Come back and see what is new.'],
  } as const;
  const fr = {
    'unfinished-3': ['Votre inscription est presque terminée', 'Terminez vos informations pour rejoindre votre assemblée. Cela prend environ une minute.'],
    'unfinished-7': ['Nous avons gardé votre place', 'Revenez terminer vos informations pour que nous puissions vous placer dans votre assemblée. Nous sommes là pour vous aider.'],
    'return-3': ['Un enseignement vous attend', 'Ouvrez l’application pour voir les nouveautés de votre assemblée.'],
    'return-7': ['Vous nous manquez', 'Vos frères et sœurs prennent de vos nouvelles. Revenez voir les nouveautés.'],
  } as const;
  const [title, body] = (french ? fr : en)[`${stage}-${day}` as keyof typeof en];
  return { title, body, url };
}

async function settings() {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { nudgesEnabled: true, reminderQuietDays: true } });
  return { enabled: s?.nudgesEnabled ?? false, quietDays: s?.reminderQuietDays ?? 7 };
}

export interface NudgeCandidate {
  personId: string;
  language: 'en' | 'fr';
  stage: Stage;
  kind: NudgeKind;
  day: 3 | 7;
  stageName: MemberStage;
}

/** Who is due a nudge by their days alone (the safety rules are applied separately, at the moment of sending). */
async function dueCandidates(now: Date, quietDays: number): Promise<NudgeCandidate[]> {
  const recent = new Date(now.getTime() - 60 * DAY);
  const rows = await prisma.memberAccount.findMany({
    where: {
      lastLoginAt: { not: null },
      person: {
        ...baseWhere,
        OR: [{ profileCompletedAt: null, memberAccount: { createdAt: { gte: recent } } }, { lastSeenAt: { gte: recent } }, { profileCompletedAt: { gte: recent } }],
      },
    },
    orderBy: { createdAt: 'asc' },
    take: SCAN,
    select: {
      createdAt: true,
      lastLoginAt: true,
      person: { select: { id: true, preferredLanguage: true, profileCompletedAt: true, lastSeenAt: true, reminders: { select: { kind: true, sentAt: true } } } },
    },
  });
  const out: NudgeCandidate[] = [];
  for (const r of rows) {
    const facts = { createdAt: r.createdAt, lastLoginAt: r.lastLoginAt, profileCompletedAt: r.person.profileCompletedAt, lastSeenAt: r.person.lastSeenAt };
    const stageName = memberStage(facts, now, quietDays);
    if (stageName === 'NOT_CONFIRMED' || stageName === 'ACTIVE') continue;
    const stage: Stage = stageName === 'UNFINISHED' ? 'unfinished' : 'return';
    const start = spellStart(facts, stageName);
    const ageDays = (now.getTime() - start.getTime()) / DAY;
    const inSpell = new Set(r.person.reminders.filter((x) => (x.kind === 'NUDGE_DAY3' || x.kind === 'NUDGE_DAY7') && x.sentAt > start).map((x) => x.kind));
    let kind: NudgeKind | null = null;
    if (ageDays >= 3 && !inSpell.has('NUDGE_DAY3')) kind = 'NUDGE_DAY3';
    else if (ageDays >= 7 && inSpell.has('NUDGE_DAY3') && !inSpell.has('NUDGE_DAY7')) kind = 'NUDGE_DAY7';
    if (!kind) continue;
    out.push({ personId: r.person.id, language: r.person.preferredLanguage === 'fr' ? 'fr' : 'en', stage, kind, day: kind === 'NUDGE_DAY3' ? 3 : 7, stageName });
  }
  return out;
}

/** Re-reads the person's latest facts and applies the safety rules. */
async function allowedNow(personId: string, now: Date, ignoreHours = false): Promise<boolean> {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { lastSeenAt: true, reminders: { select: { sentAt: true } } } });
  if (!p) return false;
  return nudgeBlock({ now, lastSeenAt: p.lastSeenAt, sentAts: p.reminders.map((r) => r.sentAt), ignoreHours }) === null;
}

/** How many people are waiting for each nudge, ignoring only the time of day (for the admin, before switching on). */
export async function nudgePending(now = new Date()): Promise<Record<NudgeKind, number>> {
  const { quietDays } = await settings();
  const out: Record<NudgeKind, number> = { NUDGE_DAY3: 0, NUDGE_DAY7: 0 };
  for (const c of await dueCandidates(now, quietDays)) if (await allowedNow(c.personId, now, true)) out[c.kind] += 1;
  return out;
}

export async function nudgeStats(now = new Date()) {
  const rows = await prisma.memberReminder.findMany({ where: { kind: { in: NUDGE_KINDS }, sentAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { kind: true, sentAt: true } });
  const last7: Record<NudgeKind, number> = { NUDGE_DAY3: 0, NUDGE_DAY7: 0 };
  let sentToday = 0;
  for (const r of rows) {
    last7[r.kind as NudgeKind] += 1;
    if (r.sentAt.getTime() >= now.getTime() - 24 * HOUR) sentToday += 1;
  }
  return { sentToday, last7 };
}

export async function processMemberNudges(now = new Date()): Promise<{ sent: Partial<Record<NudgeKind, number>>; reason?: string }> {
  const s = await settings();
  if (!s.enabled) return { sent: {}, reason: 'off' };
  if (!isCameroonDaytime(now)) return { sent: {}, reason: 'night' };
  const sent: Partial<Record<NudgeKind, number>> = {};
  let room = PER_RUN;
  for (const c of await dueCandidates(now, s.quietDays)) {
    if (room <= 0) break;
    // The rules are checked now, with the person's latest facts (they may have just been in the app).
    if (!(await allowedNow(c.personId, now))) continue;
    // Claim first, so a slow send is never repeated by the next run; give the claim back if the send fails.
    const claim = await prisma.memberReminder.create({ data: { personId: c.personId, kind: c.kind, sentAt: now } });
    try {
      const text = nudgeText(c.stage, c.day, c.language === 'fr');
      await notifyMemberNudge(c.personId, { stage: c.stage, day: c.day, ...text });
    } catch (err) {
      await prisma.memberReminder.delete({ where: { id: claim.id } }).catch(() => {});
      console.error('[nudges] could not send', { error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    sent[c.kind] = (sent[c.kind] ?? 0) + 1;
    room -= 1;
  }
  return { sent };
}
