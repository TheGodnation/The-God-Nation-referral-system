import type { ReminderKind } from '@prisma/client';
import { prisma } from './prisma';
import { EmailService, emailConfigured } from './email';
import { CLIENT_URL } from './env';
import { reminderText } from './reminderTemplates';
import { unsubscribeUrl } from './unsubscribe';

// Reminder emails to members who started joining and went quiet, and to
// members who have been away a while. Off until the central admin switches
// them on; never more than the daily cap in one day; each reminder is sent at
// most once (WINBACK once per quiet spell); the "we miss you" email goes only
// to members who agreed to emails, and carries a one-click unsubscribe.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KINDS: ReminderKind[] = ['FINISH_SIGNUP_1', 'FINISH_SIGNUP_2', 'FINISH_PROFILE', 'WINBACK'];

export interface Candidate {
  personId: string;
  email: string;
  name: string | null;
  language: 'en' | 'fr';
}

const realName = (name: string, email: string) => (name && name !== email && !name.includes('@') ? name : null);

async function reminderSettings() {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { remindersEnabled: true, reminderQuietDays: true, reminderDailyCap: true } });
  return { enabled: s?.remindersEnabled ?? false, quietDays: s?.reminderQuietDays ?? 7, dailyCap: s?.reminderDailyCap ?? 40 };
}

const baseWhere = { erasedAt: null, deletionRequestedAt: null, isTestData: false };

async function signupCandidates(kind: 'FINISH_SIGNUP_1' | 'FINISH_SIGNUP_2' | 'FINISH_PROFILE', now: Date, take: number): Promise<Candidate[]> {
  const t = (ms: number) => new Date(now.getTime() - ms);
  const range =
    kind === 'FINISH_SIGNUP_1' ? { gte: t(2 * DAY), lte: t(2 * HOUR) } : kind === 'FINISH_SIGNUP_2' ? { gte: t(14 * DAY), lte: t(3 * DAY) } : { gte: t(14 * DAY), lte: t(1 * DAY) };
  const confirmed = kind === 'FINISH_PROFILE';
  const rows = await prisma.memberAccount.findMany({
    where: {
      createdAt: range,
      lastLoginAt: confirmed ? { not: null } : null,
      person: { ...baseWhere, profileCompletedAt: null, reminders: { none: { kind } } },
    },
    orderBy: { createdAt: 'asc' },
    take,
    select: { email: true, person: { select: { id: true, name: true, preferredLanguage: true } } },
  });
  return rows.map((r) => ({ personId: r.person.id, email: r.email, name: realName(r.person.name, r.email), language: r.person.preferredLanguage === 'fr' ? 'fr' : 'en' }));
}

async function winbackCandidates(now: Date, quietDays: number, take: number): Promise<Candidate[]> {
  const quietBefore = new Date(now.getTime() - quietDays * DAY);
  const rows = await prisma.memberAccount.findMany({
    where: {
      person: {
        ...baseWhere,
        profileCompletedAt: { not: null, gte: new Date(now.getTime() - 365 * DAY) },
        OR: [{ lastSeenAt: { lt: quietBefore, gte: new Date(now.getTime() - 180 * DAY) } }, { lastSeenAt: null, profileCompletedAt: { lt: quietBefore } }],
      },
    },
    orderBy: { createdAt: 'asc' },
    take: take * 4,
    select: { email: true, person: { select: { id: true, name: true, preferredLanguage: true, lastSeenAt: true, profileCompletedAt: true } } },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.person.id);
  const [consents, sent] = await Promise.all([
    prisma.contactConsent.findMany({ where: { personId: { in: ids }, channel: 'EMAIL' }, orderBy: { createdAt: 'desc' }, select: { personId: true, granted: true } }),
    prisma.memberReminder.findMany({ where: { personId: { in: ids }, kind: 'WINBACK' }, select: { personId: true, sentAt: true } }),
  ]);
  const latest = new Map<string, boolean>();
  for (const c of consents) if (c.personId && !latest.has(c.personId)) latest.set(c.personId, c.granted);
  const out: Candidate[] = [];
  for (const r of rows) {
    if (latest.get(r.person.id) !== true) continue; // never asked, or said no
    const baseline = r.person.lastSeenAt ?? r.person.profileCompletedAt!;
    // One email per quiet spell: none if one went out since they were last seen.
    if (sent.some((s) => s.personId === r.person.id && s.sentAt > baseline)) continue;
    out.push({ personId: r.person.id, email: r.email, name: realName(r.person.name, r.email), language: r.person.preferredLanguage === 'fr' ? 'fr' : 'en' });
    if (out.length >= take) break;
  }
  return out;
}

async function candidatesFor(kind: ReminderKind, now: Date, quietDays: number, take: number): Promise<Candidate[]> {
  return kind === 'WINBACK' ? winbackCandidates(now, quietDays, take) : signupCandidates(kind, now, take);
}

/** How many people would get each reminder if it were sent now (for the admin, before switching on). */
export async function reminderPending(now = new Date()): Promise<Record<ReminderKind, number>> {
  const { quietDays } = await reminderSettings();
  const out = {} as Record<ReminderKind, number>;
  for (const k of KINDS) out[k] = (await candidatesFor(k, now, quietDays, 500)).length;
  return out;
}

/** What was sent today and over the last 7 days, by kind. */
export async function reminderStats(now = new Date()) {
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since1 = new Date(now.getTime() - DAY);
  const rows = await prisma.memberReminder.findMany({ where: { sentAt: { gte: since7 } }, select: { kind: true, sentAt: true } });
  const last7 = {} as Record<ReminderKind, number>;
  for (const k of KINDS) last7[k] = 0;
  let sentToday = 0;
  for (const r of rows) {
    last7[r.kind] += 1;
    if (r.sentAt >= since1) sentToday += 1;
  }
  return { sentToday, last7 };
}

export async function processMemberReminders(now = new Date()): Promise<{ sent: Partial<Record<ReminderKind, number>>; reason?: string }> {
  const settings = await reminderSettings();
  if (!settings.enabled) return { sent: {}, reason: 'off' };
  if (!emailConfigured) return { sent: {}, reason: 'email-not-configured' };

  const { sentToday } = await reminderStats(now);
  let room = Math.max(0, settings.dailyCap - sentToday);
  const sent: Partial<Record<ReminderKind, number>> = {};

  for (const kind of KINDS) {
    if (room <= 0) break;
    for (const c of await candidatesFor(kind, now, settings.quietDays, room)) {
      if (room <= 0) break;
      // Claim first, so a slow send is never repeated by the next run; give the claim back if the send fails.
      const claim = await prisma.memberReminder.create({ data: { personId: c.personId, kind, sentAt: now } });
      const text = reminderText(kind, c.language, c.name);
      const result = await EmailService.sendReminder({
        to: c.email,
        subject: text.subject,
        paragraphs: text.paragraphs,
        buttonLabel: text.buttonLabel,
        buttonUrl: `${CLIENT_URL.replace(/\/+$/, '')}/member/login${c.language === 'fr' ? '?lang=fr' : ''}`,
        footer: text.footer,
        ...(kind === 'WINBACK' ? { unsubscribeUrl: unsubscribeUrl(c.personId, c.language) } : {}),
      });
      if (!result.ok) {
        await prisma.memberReminder.delete({ where: { id: claim.id } }).catch(() => {});
        if (result.skipped) return { sent, reason: 'email-not-configured' };
        continue;
      }
      sent[kind] = (sent[kind] ?? 0) + 1;
      room -= 1;
    }
  }
  return { sent };
}

/** Checks once an hour (the first check a few minutes after the server starts). */
export function startMemberReminderLoop(): void {
  const run = () => processMemberReminders().catch((err) => console.error('[reminders] failed', { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 5 * 60 * 1000).unref();
  setInterval(run, HOUR).unref();
}
