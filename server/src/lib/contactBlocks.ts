import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { recordAudit } from './audit';

// ---------------------------------------------------------------------------
// Three ways for the central admin to delete a person:
//   FREE      the person may register again, as a brand-new member
//   APPROVAL  they may register again only if the admin allows it
//   NEVER     their WhatsApp number and email address are refused for good
//
// For APPROVAL and NEVER the number and the email address are kept on a list
// (ContactBlock), with the person's name and the admin's note: the only
// personal details kept after a deletion, visible to the central admin only.
// A sign-up with a listed number or email address gets the same ordinary
// reply as anyone else and creates nothing (so the person is never told),
// and the attempt is counted for the admin to see.
//
// Whatever the choice, the old sign-up record keeps only what the
// statistics and the referring leader's credit need: its number, name and
// email are wiped so the number is free again (the list is what blocks it).
// ---------------------------------------------------------------------------

export type DeletionMode = 'FREE' | 'APPROVAL' | 'NEVER';
export const DELETION_MODES: DeletionMode[] = ['FREE', 'APPROVAL', 'NEVER'];

type Tx = Prisma.TransactionClient;

interface Contacts {
  whatsappNumber: string | null;
  emails: (string | null | undefined)[];
}

const clean = (emails: (string | null | undefined)[]): string[] => [...new Set(emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e && !e.endsWith('.invalid')))];

/** Puts the person's number and email addresses on the list (APPROVAL or NEVER). Does nothing for FREE. */
export async function blockContacts(
  tx: Tx,
  opts: { mode: DeletionMode; contacts: Contacts; personName: string; note?: string | null; byUserId?: string | null },
): Promise<void> {
  if (opts.mode === 'FREE') return;
  const mode = opts.mode;
  const groupId = crypto.randomUUID();
  const rows: { kind: 'WHATSAPP' | 'EMAIL'; value: string }[] = [
    ...(opts.contacts.whatsappNumber && !opts.contacts.whatsappNumber.startsWith('deleted:') ? [{ kind: 'WHATSAPP' as const, value: opts.contacts.whatsappNumber }] : []),
    ...clean(opts.contacts.emails).map((value) => ({ kind: 'EMAIL' as const, value })),
  ];
  const note = opts.note?.trim().slice(0, 500) || null;
  for (const r of rows) {
    const data = { mode, status: 'ACTIVE' as const, groupId, personName: opts.personName.slice(0, 200), note, createdByUserId: opts.byUserId ?? null, attempts: 0, lastAttemptAt: null, lastAttemptVia: null, decidedAt: null, decidedByUserId: null };
    await tx.contactBlock.upsert({ where: { kind_value: { kind: r.kind, value: r.value } }, create: { ...r, ...data }, update: data });
  }
}

/**
 * Wipes what identifies the person from their old sign-up records and the "stay connected" box,
 * freeing the number. The record itself stays (for the statistics and the referring leader's credit).
 */
export async function eraseSignupTraces(tx: Tx, opts: { personId: string; whatsappNumber: string | null }): Promise<void> {
  const registrations = await tx.registration.findMany({
    where: { OR: [{ personId: opts.personId }, ...(opts.whatsappNumber ? [{ normalizedWhatsApp: opts.whatsappNumber }] : [])] },
    select: { id: true },
  });
  for (const r of registrations) {
    await tx.registration.update({
      where: { id: r.id },
      data: { normalizedWhatsApp: `deleted:${r.id}`, name: 'Member', email: null, personId: null, fbclid: null, ttclid: null, gclid: null },
    });
  }
  if (opts.whatsappNumber) await tx.lead.deleteMany({ where: { whatsappNumber: opts.whatsappNumber } });
}

/** The active entries (if any) that stop this number or email address from registering. */
export async function activeBlocksFor(whatsappNumber: string | null | undefined, email: string | null | undefined) {
  const or: Prisma.ContactBlockWhereInput[] = [];
  if (whatsappNumber) or.push({ kind: 'WHATSAPP', value: whatsappNumber });
  if (email) or.push({ kind: 'EMAIL', value: email.trim().toLowerCase() });
  if (or.length === 0) return [];
  return prisma.contactBlock.findMany({ where: { status: 'ACTIVE', OR: or } });
}

/** Counts a refused attempt, for the admin's list. Nothing about the attempt is shown to the person. */
export async function recordBlockedAttempt(blocks: { id: string; groupId: string }[], via: string): Promise<void> {
  if (blocks.length === 0) return;
  // One attempt is counted once per deletion, even when both its number and its email were used.
  const onePerGroup = [...new Map(blocks.map((b) => [b.groupId, b])).values()];
  await prisma.contactBlock.updateMany({ where: { id: { in: onePerGroup.map((b) => b.id) } }, data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastAttemptVia: via } });
  await recordAudit({ action: 'BLOCKED_CONTACT_ATTEMPT', targetType: 'ContactBlock', targetId: blocks[0].id, metadata: { via } });
}

export interface BlockGroup {
  groupId: string;
  mode: 'APPROVAL' | 'NEVER';
  status: 'ACTIVE' | 'APPROVED' | 'LIFTED';
  personName: string | null;
  note: string | null;
  whatsappNumbers: string[];
  emails: string[];
  createdAt: Date;
  attempts: number;
  lastAttemptAt: Date | null;
  decidedAt: Date | null;
}

/** The list for the admin: one entry per deletion, kept-out ones first (people who tried to come back at the top). */
export async function listBlockGroups(): Promise<BlockGroup[]> {
  const rows = await prisma.contactBlock.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 });
  const groups = new Map<string, BlockGroup>();
  for (const r of rows) {
    let g = groups.get(r.groupId);
    if (!g) {
      g = { groupId: r.groupId, mode: r.mode, status: r.status, personName: r.personName, note: r.note, whatsappNumbers: [], emails: [], createdAt: r.createdAt, attempts: 0, lastAttemptAt: null, decidedAt: r.decidedAt };
      groups.set(r.groupId, g);
    }
    (r.kind === 'WHATSAPP' ? g.whatsappNumbers : g.emails).push(r.value);
    g.attempts += r.attempts;
    if (r.lastAttemptAt && (!g.lastAttemptAt || r.lastAttemptAt > g.lastAttemptAt)) g.lastAttemptAt = r.lastAttemptAt;
  }
  const rank = (g: BlockGroup) => (g.status !== 'ACTIVE' ? 2 : g.attempts > 0 ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || (b.lastAttemptAt?.getTime() ?? b.createdAt.getTime()) - (a.lastAttemptAt?.getTime() ?? a.createdAt.getTime()));
}

/** Lets the person register again ("approve" for APPROVAL, "lift" for NEVER). Everything from the same deletion at once. */
export async function allowBack(groupId: string, adminUserId: string): Promise<boolean> {
  const rows = await prisma.contactBlock.findMany({ where: { groupId, status: 'ACTIVE' }, select: { id: true, mode: true } });
  if (rows.length === 0) return false;
  const mode = rows[0].mode;
  await prisma.contactBlock.updateMany({ where: { groupId, status: 'ACTIVE' }, data: { status: mode === 'APPROVAL' ? 'APPROVED' : 'LIFTED', decidedAt: new Date(), decidedByUserId: adminUserId } });
  await recordAudit({ actorId: adminUserId, action: mode === 'APPROVAL' ? 'CONTACT_BLOCK_APPROVED' : 'CONTACT_BLOCK_LIFTED', targetType: 'ContactBlock', targetId: groupId });
  return true;
}

/** Turns "only with my approval" into "never" (the admin looked at the attempt and said no for good). */
export async function keepOutForGood(groupId: string, adminUserId: string): Promise<boolean> {
  const res = await prisma.contactBlock.updateMany({ where: { groupId, status: 'ACTIVE', mode: 'APPROVAL' }, data: { mode: 'NEVER', decidedAt: new Date(), decidedByUserId: adminUserId } });
  if (res.count === 0) return false;
  await recordAudit({ actorId: adminUserId, action: 'CONTACT_BLOCK_MADE_PERMANENT', targetType: 'ContactBlock', targetId: groupId });
  return true;
}
