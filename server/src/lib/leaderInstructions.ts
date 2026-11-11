import type { InstructionAudience, Language } from '@prisma/client';
import { prisma } from './prisma';
import { getHeadquartersCommunityId, getCommunityGeneration } from './tree';
import { translateInstructionBeforeSending } from './translation';
import { pushToPersons } from './push';
import { sendPrivateNotice, isFrench, languagesOf } from './privateNotice';
import { CLIENT_URL } from './env';

// Instructions from the National Coordinator (the central admin) to leaders. See schema.prisma's
// LeaderInstruction: to every leader, to the leaders of chosen generations, or to hand-picked leaders. The
// people it goes to are written down when it is sent, so the follow-up ("seen / done / late") stays exact.

export const MAX_TITLE_CHARS = 200;
export const MAX_BODY_CHARS = 20000;
export const MAX_NOTE_CHARS = 1000;
const REMIND_EVERY_MS = 12 * 60 * 60 * 1000;

export interface LeaderListing {
  personId: string;
  name: string;
  generations: number[];
  assemblies: string[];
}

/** Everyone who currently leads an assembly (an active assembly-scoped leader role), with the generations they lead in. */
export async function listLeaders(): Promise<LeaderListing[]> {
  const roles = await prisma.roleAssignment.findMany({
    where: { roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null }, person: { erasedAt: null } },
    select: { personId: true, communityId: true, person: { select: { name: true } }, community: { select: { name: true } } },
  });
  const headquartersId = await getHeadquartersCommunityId();
  const generationOf = new Map<string, number | null>();
  const byPerson = new Map<string, LeaderListing>();
  for (const role of roles) {
    let generation: number | null = null;
    if (headquartersId && role.communityId) {
      if (!generationOf.has(role.communityId)) generationOf.set(role.communityId, await getCommunityGeneration(role.communityId, headquartersId));
      generation = generationOf.get(role.communityId) ?? null;
    }
    const entry = byPerson.get(role.personId) ?? { personId: role.personId, name: role.person.name, generations: [], assemblies: [] };
    if (generation !== null && !entry.generations.includes(generation)) entry.generations.push(generation);
    if (role.community?.name && !entry.assemblies.includes(role.community.name)) entry.assemblies.push(role.community.name);
    byPerson.set(role.personId, entry);
  }
  return Array.from(byPerson.values())
    .map((l) => ({ ...l, generations: l.generations.sort((a, b) => a - b) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The generations that have at least one leader, lowest first. */
export function generationsOf(leaders: LeaderListing[]): number[] {
  return Array.from(new Set(leaders.flatMap((l) => l.generations))).sort((a, b) => a - b);
}

export function recipientsFor(leaders: LeaderListing[], audience: InstructionAudience, generations: number[], picked: string[]): string[] {
  if (audience === 'ALL_LEADERS') return leaders.map((l) => l.personId);
  if (audience === 'GENERATIONS') return leaders.filter((l) => l.generations.some((g) => generations.includes(g))).map((l) => l.personId);
  const wanted = new Set(picked);
  return leaders.filter((l) => wanted.has(l.personId)).map((l) => l.personId);
}

export interface CreateInstructionInput {
  title: string;
  body: string;
  audience: InstructionAudience;
  generations: number[];
  personIds: string[];
  dueAt: Date | null;
  repliesVisible: boolean;
  createdByUserId: string | null;
  createdByPersonId: string | null;
  /** Sent by a generation's representative rather than the National Coordinator. */
  fromRepresentative?: boolean;
}

/** An instruction's title in the reader's language (the translation when it is ready, otherwise the original). */
export function titleIn(i: { title: string; titleTr: string | null; language: Language | null }, french: boolean): string {
  if (!i.language || !i.titleTr) return i.title;
  return (i.language === 'fr') === french ? i.title : i.titleTr;
}

/** Pushes to each leader in their own language. Never throws. */
async function pushInstruction(personIds: string[], i: { title: string; titleTr: string | null; language: Language | null }, heading: { en: string; fr: string }): Promise<void> {
  try {
    const langs = await languagesOf(personIds);
    const fr = personIds.filter((p) => isFrench(langs.get(p)));
    const en = personIds.filter((p) => !isFrench(langs.get(p)));
    if (en.length) await pushToPersons(en, { title: heading.en, body: titleIn(i, false), url: '/member/me?section=instructions', urgent: true });
    if (fr.length) await pushToPersons(fr, { title: heading.fr, body: titleIn(i, true), url: '/member/me?section=instructions', urgent: true });
  } catch {
    // best effort
  }
}

/** The person an instruction's private message comes from: whoever sent it (the National Coordinator's own profile, or the representative). */
async function senderPersonOf(createdByPersonId: string | null, createdByUserId: string | null): Promise<string | null> {
  if (createdByPersonId) return createdByPersonId;
  if (!createdByUserId) return null;
  const user = await prisma.user.findUnique({ where: { id: createdByUserId }, select: { personId: true } });
  return user?.personId ?? null;
}

export const instructionLink = (id: string): string => `${CLIENT_URL}/member/leadership-dashboard?section=instructions&instruction=${id}`;

/** The short private message a leader receives about an instruction (or a reminder), in their own language. */
export function instructionNotice(kind: 'new' | 'reminder', title: string, dueAt: Date | null, id: string, french: boolean): string {
  const due = dueAt ? dueAt.toLocaleDateString(french ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Douala', day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const link = instructionLink(id);
  if (french) {
    return `${kind === 'new' ? '📌 Nouvelle instruction' : '⏰ Rappel'} : ${title}\n${due ? `Pour le : ${due}\n` : ''}${kind === 'new' ? 'Touchez pour la lire et la marquer comme faite' : 'Merci de la lire et de la marquer comme faite'} :\n${link}`;
  }
  return `${kind === 'new' ? '📌 New instruction' : '⏰ Reminder'}: ${title}\n${due ? `Due: ${due}\n` : ''}${kind === 'new' ? 'Tap to read it and mark it done' : 'Please read it and mark it done'}:\n${link}`;
}

/** Sends the private message to each leader (a few at a time). Never throws. */
async function sendInstructionNotices(kind: 'new' | 'reminder', fromPersonId: string | null, personIds: string[], ins: { id: string; title: string; titleTr: string | null; language: Language | null }, dueAt: Date | null): Promise<void> {
  if (!fromPersonId || personIds.length === 0) return;
  const langs = await languagesOf(personIds);
  for (let i = 0; i < personIds.length; i += 10) {
    await Promise.all(personIds.slice(i, i + 10).map((pid) => sendPrivateNotice(fromPersonId, pid, instructionNotice(kind, titleIn(ins, isFrench(langs.get(pid))), dueAt, ins.id, isFrench(langs.get(pid))))));
  }
}

export type CreateInstructionResult = { ok: true; id: string; recipients: number } | { ok: false; status: number; error: string };

export async function createInstruction(input: CreateInstructionInput): Promise<CreateInstructionResult> {
  const leaders = await listLeaders();
  const personIds = recipientsFor(leaders, input.audience, input.generations, input.personIds);
  if (personIds.length === 0) return { ok: false, status: 400, error: 'No leader matches this choice, so nobody would receive it.' };

  // Saved first, so a slow or busy translator can never lose it.
  const instruction = await prisma.leaderInstruction.create({
    data: {
      title: input.title,
      body: input.body,
      audience: input.audience,
      generations: input.audience === 'GENERATIONS' ? input.generations : [],
      dueAt: input.dueAt,
      repliesVisible: input.repliesVisible,
      createdByUserId: input.createdByUserId,
      createdByPersonId: input.createdByPersonId,
      recipients: { createMany: { data: personIds.map((personId) => ({ personId })) } },
    },
    select: { id: true },
  });
  // Translated into the other language (title and text apart). Given a few seconds so it usually goes out in both
  // languages; whatever is not ready then carries on in the background and is retried (5 min, 15 min, 1 hour).
  await translateInstructionBeforeSending(instruction.id);
  const saved = await prisma.leaderInstruction.findUniqueOrThrow({ where: { id: instruction.id }, select: { id: true, title: true, titleTr: true, language: true } });
  await prisma.notification.createMany({
    data: personIds.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'INSTRUCTION_RECEIVED' as const,
      metadata: { dueAt: input.dueAt?.toISOString() ?? null } as any,
      targetType: 'LeaderInstruction',
      targetId: instruction.id,
    })),
  });
  await pushInstruction(
    personIds,
    saved,
    input.fromRepresentative
      ? { en: '📌 Instruction from your representative', fr: '📌 Instruction de votre représentant' }
      : { en: '📌 Instruction from the National Coordinator', fr: '📌 Instruction du Coordinateur national' },
  );
  // Also as a short private message from the sender, with a link that opens the instruction (it is marked Seen then).
  await sendInstructionNotices('new', await senderPersonOf(input.createdByPersonId, input.createdByUserId), personIds, saved, input.dueAt).catch(() => {});
  return { ok: true, id: instruction.id, recipients: personIds.length };
}

function statusOf(r: { seenAt: Date | null; doneAt: Date | null }, dueAt: Date | null, now: Date): 'DONE' | 'LATE' | 'SEEN' | 'WAITING' {
  if (r.doneAt) return 'DONE';
  if (dueAt && dueAt < now) return 'LATE';
  return r.seenAt ? 'SEEN' : 'WAITING';
}

/** The central admin's list: each instruction with how many people it went to, have seen it, are done, are late. */
export async function listInstructions(onlyCreatedByPersonId?: string) {
  const rows = await prisma.leaderInstruction.findMany({
    where: onlyCreatedByPersonId ? { createdByPersonId: onlyCreatedByPersonId } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { recipients: { select: { seenAt: true, doneAt: true } } },
  });
  const now = new Date();
  return rows.map((i) => ({
    id: i.id,
    title: i.title,
    titleTr: i.titleTr,
    language: i.language,
    audience: i.audience,
    generations: i.generations,
    dueAt: i.dueAt,
    createdAt: i.createdAt,
    total: i.recipients.length,
    seen: i.recipients.filter((r) => r.seenAt || r.doneAt).length,
    done: i.recipients.filter((r) => r.doneAt).length,
    late: i.recipients.filter((r) => !r.doneAt && i.dueAt && i.dueAt < now).length,
  }));
}

/** One instruction with each person's status, for the follow-up screen. */
export async function instructionTracker(id: string) {
  const i = await prisma.leaderInstruction.findUnique({
    where: { id },
    include: { recipients: { include: { person: { select: { id: true, name: true } } }, orderBy: { person: { name: 'asc' } } } },
  });
  if (!i) return null;
  const now = new Date();
  return {
    id: i.id,
    title: i.title,
    body: i.body,
    language: i.language,
    titleTr: i.titleTr,
    bodyTr: i.bodyTr,
    audience: i.audience,
    generations: i.generations,
    dueAt: i.dueAt,
    repliesVisible: i.repliesVisible,
    createdAt: i.createdAt,
    recipients: i.recipients.map((r) => ({
      personId: r.person.id,
      name: r.person.name,
      status: statusOf(r, i.dueAt, now),
      seenAt: r.seenAt,
      doneAt: r.doneAt,
      note: r.note,
      remindedAt: r.remindedAt,
    })),
  };
}

/** Reminds everyone who has not finished (never the same person twice within 12 hours). */
export async function remindUnfinished(id: string): Promise<{ reminded: number } | null> {
  const i = await prisma.leaderInstruction.findUnique({ where: { id }, include: { recipients: true } });
  if (!i) return null;
  const cutoff = new Date(Date.now() - REMIND_EVERY_MS);
  const targets = i.recipients.filter((r) => !r.doneAt && (!r.remindedAt || r.remindedAt < cutoff));
  if (targets.length === 0) return { reminded: 0 };
  const personIds = targets.map((r) => r.personId);
  await prisma.leaderInstructionRecipient.updateMany({ where: { id: { in: targets.map((r) => r.id) } }, data: { remindedAt: new Date() } });
  await prisma.notification.createMany({
    data: personIds.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'INSTRUCTION_REMINDER' as const,
      metadata: { dueAt: i.dueAt?.toISOString() ?? null } as any,
      targetType: 'LeaderInstruction',
      targetId: i.id,
    })),
  });
  await pushInstruction(personIds, i, { en: '⏰ Reminder from the National Coordinator', fr: '⏰ Rappel du Coordinateur national' });
  await sendInstructionNotices('reminder', await senderPersonOf(i.createdByPersonId, i.createdByUserId), personIds, i, i.dueAt).catch(() => {});
  return { reminded: personIds.length };
}

/** What one leader sees: the instructions sent to them, newest first. Others' notes only when the instruction allows it. */
export async function instructionsFor(personId: string) {
  const mine = await prisma.leaderInstructionRecipient.findMany({
    where: { personId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      instruction: {
        include: { recipients: { where: { doneAt: { not: null }, note: { not: null } }, include: { person: { select: { name: true } } } } },
      },
    },
  });
  const now = new Date();
  return mine.map((r) => ({
    id: r.instruction.id,
    // Sent by the central admin (an admin account) or by a generation's representative.
    sender: r.instruction.createdByUserId ? ('NATIONAL_COORDINATOR' as const) : ('REPRESENTATIVE' as const),
    title: r.instruction.title,
    body: r.instruction.body,
    language: r.instruction.language,
    titleTr: r.instruction.titleTr,
    bodyTr: r.instruction.bodyTr,
    dueAt: r.instruction.dueAt,
    createdAt: r.instruction.createdAt,
    status: statusOf(r, r.instruction.dueAt, now),
    seenAt: r.seenAt,
    doneAt: r.doneAt,
    note: r.note,
    replies: r.instruction.repliesVisible
      ? r.instruction.recipients.filter((o) => o.personId !== personId).map((o) => ({ name: o.person.name, note: o.note, doneAt: o.doneAt }))
      : [],
  }));
}

export async function markSeen(instructionId: string, personId: string): Promise<boolean> {
  const r = await prisma.leaderInstructionRecipient.findUnique({ where: { instructionId_personId: { instructionId, personId } } });
  if (!r) return false;
  if (!r.seenAt) await prisma.leaderInstructionRecipient.update({ where: { id: r.id }, data: { seenAt: new Date() } });
  return true;
}

export async function markDone(instructionId: string, personId: string, note: string | null): Promise<boolean> {
  const r = await prisma.leaderInstructionRecipient.findUnique({ where: { instructionId_personId: { instructionId, personId } } });
  if (!r) return false;
  const now = new Date();
  await prisma.leaderInstructionRecipient.update({ where: { id: r.id }, data: { seenAt: r.seenAt ?? now, doneAt: r.doneAt ?? now, note } });
  return true;
}
