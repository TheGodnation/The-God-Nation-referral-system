import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { findActiveScopedRole } from './leadership';
import {
  notifyExcuseRequested,
  notifyRemovalDecided,
  notifyRemovalRequested,
  notifyRemovedFromAssembly,
  notifySanctionEnded,
  notifySanctionLifted,
  notifySanctionPlaced,
} from './notifications';

// Sanctions. A MUTE lets a person read an assembly but not write in it for 3, 7, 15 or 30 days (it ends by
// itself). Who may mute: the central admin anywhere; a leader only in an assembly they lead (the per-generation
// representatives join as a third kind of authority). Leaders cannot lift a mute the central admin placed.
// Leaders cannot remove anyone: they send a removal request, and only the central admin decides.

export const MUTE_DAYS = [3, 7, 15, 30] as const;
export type SanctionRoleName = 'ADMIN' | 'LEADER' | 'REPRESENTATIVE';
const DAY = 24 * 60 * 60 * 1000;

export class SanctionError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

/** The kind of authority this person has over an assembly, or null. */
export async function authorityFor(personId: string, communityId: string): Promise<SanctionRoleName | null> {
  if (await isCentralAdminPerson(personId)) return 'ADMIN';
  if (await findActiveScopedRole(personId, 'COMMUNITY', communityId)) return 'LEADER';
  return null;
}

/** A person is "a leader" if they lead any assembly. Leaders cannot be muted or reported by other leaders. */
async function isAnyLeader(personId: string): Promise<boolean> {
  const role = await prisma.roleAssignment.findFirst({ where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { id: true } });
  return Boolean(role);
}

export async function activeMute(personId: string, communityId: string) {
  return prisma.memberSanction.findFirst({
    where: { personId, communityId, liftedAt: null, endsAt: { gt: new Date() } },
    orderBy: { endsAt: 'desc' },
  });
}

/** What the person sees where their mute applies (the reason, the end, whether they already asked for excuse). */
export async function muteNotice(personId: string, communityId: string) {
  const m = await activeMute(personId, communityId);
  return m ? { id: m.id, reason: m.reason, endsAt: m.endsAt, excuseSent: Boolean(m.excuseAt) } : null;
}

async function checkTarget(actorPersonId: string, actorRole: SanctionRoleName, communityId: string, personId: string) {
  if (actorPersonId === personId) throw new SanctionError('You cannot do this to yourself.');
  if (await isCentralAdminPerson(personId)) throw new SanctionError('The central admin cannot be sanctioned.', 403);
  const membership = await prisma.communityMembership.findUnique({ where: { personId_communityId: { personId, communityId } } });
  if (membership?.status !== 'ACTIVE') throw new SanctionError('This person is not a member of this assembly.', 404);
  if (actorRole !== 'ADMIN' && (await isAnyLeader(personId))) {
    throw new SanctionError('A leader cannot be sanctioned by another leader. Send the matter to the central admin.', 403);
  }
}

async function authorize(actorPersonId: string, communityId: string) {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, name: true } });
  if (!community) throw new SanctionError('Assembly not found.', 404);
  const role = await authorityFor(actorPersonId, communityId);
  if (!role) throw new SanctionError('You can only do this in an assembly you lead.', 403);
  return { community, role };
}

function cleanReason(raw: string): string {
  const reason = raw.trim();
  if (reason.length < 3) throw new SanctionError('Please give a reason.');
  if (reason.length > 500) throw new SanctionError('The reason is too long (500 characters at most).');
  return reason;
}

export async function placeMute(input: { actorPersonId: string; communityId: string; personId: string; days: number; reason: string }) {
  if (!(MUTE_DAYS as readonly number[]).includes(input.days)) throw new SanctionError(`Choose ${MUTE_DAYS.join(', ')} days.`);
  const reason = cleanReason(input.reason);
  const { community, role } = await authorize(input.actorPersonId, input.communityId);
  await checkTarget(input.actorPersonId, role, input.communityId, input.personId);
  if (await activeMute(input.personId, input.communityId)) throw new SanctionError('This person is already muted in this assembly.', 409);
  const now = new Date();
  const sanction = await prisma.memberSanction.create({
    data: {
      personId: input.personId,
      communityId: input.communityId,
      reason,
      days: input.days,
      startsAt: now,
      endsAt: new Date(now.getTime() + input.days * DAY),
      createdByPersonId: input.actorPersonId,
      createdByRole: role,
    },
  });
  await notifySanctionPlaced(input.personId, { id: sanction.id, assemblyName: community.name, endsAt: sanction.endsAt, reason }).catch(() => {});
  return { sanction, assemblyName: community.name };
}

export async function liftMute(sanctionId: string, actorPersonId: string) {
  const sanction = await prisma.memberSanction.findUnique({ where: { id: sanctionId }, include: { community: { select: { name: true } } } });
  if (!sanction) throw new SanctionError('Sanction not found.', 404);
  const role = await authorityFor(actorPersonId, sanction.communityId);
  if (!role) throw new SanctionError('You can only do this in an assembly you lead.', 403);
  if (sanction.liftedAt || sanction.endsAt <= new Date()) throw new SanctionError('This mute is no longer active.', 409);
  if (sanction.createdByRole === 'ADMIN' && role !== 'ADMIN') {
    throw new SanctionError('Only the central admin can lift a mute the central admin placed.', 403, 'ADMIN_ONLY');
  }
  const updated = await prisma.memberSanction.update({ where: { id: sanctionId }, data: { liftedAt: new Date(), liftedByPersonId: actorPersonId, liftedByRole: role } });
  await notifySanctionLifted(sanction.personId, { id: sanction.id, assemblyName: sanction.community.name }).catch(() => {});
  return { sanction: updated, assemblyName: sanction.community.name };
}

/** The muted person asks for excuse — once per mute, with a short message. Goes to whoever muted them. */
export async function sendExcuse(personId: string, sanctionId: string, rawMessage: string) {
  const message = rawMessage.trim();
  if (message.length < 3) throw new SanctionError('Please write a few words.');
  if (message.length > 500) throw new SanctionError('The message is too long (500 characters at most).');
  const sanction = await prisma.memberSanction.findUnique({ where: { id: sanctionId }, include: { community: { select: { name: true } }, person: { select: { name: true } } } });
  if (!sanction || sanction.personId !== personId) throw new SanctionError('Sanction not found.', 404);
  if (sanction.liftedAt || sanction.endsAt <= new Date()) throw new SanctionError('This mute is no longer active.', 409);
  if (sanction.excuseAt) throw new SanctionError('You have already asked for excuse.', 409);
  await prisma.memberSanction.update({ where: { id: sanctionId }, data: { excuseMessage: message, excuseAt: new Date() } });
  const target = sanction.createdByPersonId;
  if (target) {
    await notifyExcuseRequested(target, { id: sanction.id, personName: sanction.person.name, assemblyName: sanction.community.name }).catch(() => {});
  }
}

export async function requestRemoval(input: { actorPersonId: string; communityId: string; personId: string; reason: string }) {
  const reason = cleanReason(input.reason);
  const { community, role } = await authorize(input.actorPersonId, input.communityId);
  if (role === 'ADMIN') throw new SanctionError('The central admin removes people directly; no request is needed.');
  await checkTarget(input.actorPersonId, role, input.communityId, input.personId);
  const pending = await prisma.removalRequest.findFirst({ where: { personId: input.personId, communityId: input.communityId, status: 'PENDING' } });
  if (pending) throw new SanctionError('A removal request for this person is already waiting for the central admin.', 409);
  const request = await prisma.removalRequest.create({
    data: { personId: input.personId, communityId: input.communityId, reason, requestedByPersonId: input.actorPersonId, requestedByRole: role },
    include: { person: { select: { name: true } } },
  });
  const requester = await prisma.person.findUnique({ where: { id: input.actorPersonId }, select: { name: true } });
  await notifyRemovalRequested({ id: request.id, personName: request.person.name, assemblyName: community.name, requesterName: requester?.name ?? 'A leader' }).catch(() => {});
  return request;
}

async function endMembership(personId: string, communityId: string, assemblyName: string) {
  await prisma.communityMembership.updateMany({ where: { personId, communityId, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
  // Any mute there has no meaning now.
  await prisma.memberSanction.updateMany({ where: { personId, communityId, liftedAt: null, endsAt: { gt: new Date() } }, data: { liftedAt: new Date(), liftedByRole: 'ADMIN' } });
  await notifyRemovedFromAssembly(personId, { id: communityId, assemblyName }).catch(() => {});
}

/** Only the central admin: approve (the person leaves the assembly) or decline a removal request. */
export async function decideRemoval(requestId: string, approve: boolean, note: string | null, adminUserId: string | null) {
  const request = await prisma.removalRequest.findUnique({ where: { id: requestId }, include: { community: { select: { name: true } }, person: { select: { name: true } } } });
  if (!request) throw new SanctionError('Request not found.', 404);
  if (request.status !== 'PENDING') throw new SanctionError('This request has already been decided.', 409);
  const cleanNote = note?.trim() ? note.trim().slice(0, 500) : null;
  await prisma.removalRequest.update({
    where: { id: requestId },
    data: { status: approve ? 'APPROVED' : 'DECLINED', decidedAt: new Date(), decidedByUserId: adminUserId, decisionNote: cleanNote },
  });
  if (approve) await endMembership(request.personId, request.communityId, request.community.name);
  if (request.requestedByPersonId) {
    await notifyRemovalDecided(request.requestedByPersonId, { id: request.id, personName: request.person.name, assemblyName: request.community.name, approved: approve, note: cleanNote }).catch(() => {});
  }
  return { approved: approve, personName: request.person.name, assemblyName: request.community.name };
}

/** Only the central admin: remove someone from an assembly directly. */
export async function adminRemove(actorPersonId: string, communityId: string, personId: string) {
  const { community, role } = await authorize(actorPersonId, communityId);
  if (role !== 'ADMIN') throw new SanctionError('Only the central admin can remove someone from an assembly.', 403);
  await checkTarget(actorPersonId, role, communityId, personId);
  await endMembership(personId, communityId, community.name);
  await prisma.removalRequest.updateMany({ where: { personId, communityId, status: 'PENDING' }, data: { status: 'APPROVED', decidedAt: new Date() } });
  return { assemblyName: community.name };
}

// ---- Reading ----------------------------------------------------------------------------------

const RECENT = 30 * DAY;

/** Assemblies this person may sanction in: all (found by name) for the central admin, otherwise those they lead. */
export async function assembliesFor(personId: string, search: string) {
  if (await isCentralAdminPerson(personId)) {
    const q = search.trim();
    if (!q) return [];
    return prisma.community.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 });
  }
  const roles = await prisma.roleAssignment.findMany({ where: { personId, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } }, select: { communityId: true } });
  const ids = roles.map((r) => r.communityId!) ;
  const q = search.trim();
  return prisma.community.findMany({ where: { id: { in: ids }, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 50 });
}

/** Members of an assembly the actor has authority over (for choosing whom to mute). */
export async function membersFor(actorPersonId: string, communityId: string, search: string) {
  await authorize(actorPersonId, communityId);
  const q = search.trim();
  const rows = await prisma.communityMembership.findMany({
    where: { communityId, status: 'ACTIVE', person: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { whatsappNumber: { contains: q } }] } : {} },
    select: { person: { select: { id: true, name: true, whatsappNumber: true } } },
    orderBy: { person: { name: 'asc' } },
    take: 50,
  });
  return rows.map((r) => r.person);
}

async function names(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  const people = await prisma.person.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(people.map((p) => [p.id, p.name]));
}

/** Current and recent mutes in the assemblies the actor may handle (all of them for the central admin). */
export async function listSanctions(actorPersonId: string) {
  const admin = await isCentralAdminPerson(actorPersonId);
  const led = admin ? null : (await assembliesFor(actorPersonId, '')).map((c) => c.id);
  if (led && led.length === 0) return [];
  const rows = await prisma.memberSanction.findMany({
    where: { ...(led ? { communityId: { in: led } } : {}), OR: [{ liftedAt: null, endsAt: { gt: new Date() } }, { createdAt: { gt: new Date(Date.now() - RECENT) } }] },
    include: { community: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const byId = await names(rows.flatMap((r) => [r.personId, r.createdByPersonId, r.liftedByPersonId]));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: byId.get(r.personId) ?? '',
    communityId: r.communityId,
    assemblyName: r.community.name,
    reason: r.reason,
    days: r.days,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    byRole: r.createdByRole,
    byName: r.createdByPersonId ? byId.get(r.createdByPersonId) ?? '' : '',
    status: r.liftedAt ? ('LIFTED' as const) : r.endsAt.getTime() > now ? ('ACTIVE' as const) : ('ENDED' as const),
    liftedByName: r.liftedByPersonId ? byId.get(r.liftedByPersonId) ?? '' : '',
    excuseMessage: r.excuseMessage,
    excuseAt: r.excuseAt,
    // Whether this actor can lift it (leaders cannot lift what the central admin placed).
    canLift: !r.liftedAt && r.endsAt.getTime() > now && (admin || r.createdByRole !== 'ADMIN'),
  }));
}

/** Removal requests: all of them for the central admin; otherwise the ones this person sent. */
export async function listRemovalRequests(actorPersonId: string) {
  const admin = await isCentralAdminPerson(actorPersonId);
  const rows = await prisma.removalRequest.findMany({
    where: { ...(admin ? {} : { requestedByPersonId: actorPersonId }), OR: [{ status: 'PENDING' }, { createdAt: { gt: new Date(Date.now() - RECENT) } }] },
    include: { community: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });
  const byId = await names(rows.flatMap((r) => [r.personId, r.requestedByPersonId]));
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: byId.get(r.personId) ?? '',
    communityId: r.communityId,
    assemblyName: r.community.name,
    reason: r.reason,
    requestedByName: r.requestedByPersonId ? byId.get(r.requestedByPersonId) ?? '' : '',
    requestedByRole: r.requestedByRole,
    status: r.status,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  }));
}

/** Mutes that ended by themselves: tell the person once. */
export async function sweepEndedMutes(): Promise<number> {
  const due = await prisma.memberSanction.findMany({
    where: { liftedAt: null, endsAt: { lte: new Date() }, endNoticeSentAt: null },
    include: { community: { select: { name: true } } },
    take: 500,
  });
  for (const s of due) {
    const claim = await prisma.memberSanction.updateMany({ where: { id: s.id, endNoticeSentAt: null }, data: { endNoticeSentAt: new Date() } });
    if (claim.count === 1) await notifySanctionEnded(s.personId, { id: s.id, assemblyName: s.community.name }).catch(() => {});
  }
  return due.length;
}

export function startSanctionLoop(): void {
  const run = () => sweepEndedMutes().catch((err) => console.error('[sanctions] sweep failed', { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 3 * 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
