import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { requireMember } from '../lib/memberAuth';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { wouldCreateCycle, getCommunityGeneration, getHeadquartersCommunityId, getDescendantCommunityIds } from '../lib/tree';
import { communityMutationLimiter } from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { addPeopleToCommunity } from '../lib/bulkMembers';
import { notifyAddedToAssembly } from '../lib/notifications';

// The community tools (list, create, rename, assembly-or-group, move, delete…) are offered twice with the same rules:
// in the admin dashboard (admin sign-in) and in the central admin's own member profile (member sign-in). Both doors
// mount this one router; the handlers only need `req.user` (the acting admin account) for the audit record.
export function buildCommunitiesRouter() {
const router = Router();

const listQuerySchema = z.object({
  parentId: z.string().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// GET /api/admin/communities — two-mode shape: `search` for a flat name
// lookup (used by the "add Person to Community" picker), otherwise browse
// mode (children of `parentId`, or root communities when omitted). Never
// loads the whole hierarchy at once.
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);

  if (q.search) {
    const matches = await prisma.community.findMany({
      where: { name: { contains: q.search, mode: 'insensitive' } },
      include: { parent: { select: { id: true, name: true } } },
      take: 20,
      orderBy: { name: 'asc' },
    });
    return res.json({ items: matches });
  }

  const where = { parentId: q.parentId ? q.parentId : null };

  const [total, nodes, headquartersId] = await Promise.all([
    prisma.community.count({ where }),
    prisma.community.findMany({
      where,
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, memberships: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
    getHeadquartersCommunityId(),
  ]);

  // Generation is purely derived (see lib/tree.ts's getCommunityGeneration)
  // — never persisted, never computed at all when Headquarters isn't yet
  // configured (every row's generation is simply null in that case, with
  // zero extra tree walks).
  const items = headquartersId
    ? await Promise.all(nodes.map(async (n) => ({ ...n, generation: await getCommunityGeneration(n.id, headquartersId) })))
    : nodes.map((n) => ({ ...n, generation: null as number | null }));

  res.json(paginatedResult(items, total, page, pageSize));
}));

// GET /api/admin/communities/headquarters — the current National
// Headquarters designation, or null if not yet configured. Registered
// BEFORE the /:id route below so "headquarters" is never captured as a
// Community id.
router.get('/headquarters', asyncHandler(async (req, res) => {
  const headquartersId = await getHeadquartersCommunityId();
  if (!headquartersId) return res.json({ community: null });
  const community = await prisma.community.findUnique({ where: { id: headquartersId }, select: { id: true, name: true } });
  res.json({ community: community ?? null });
}));

const designateHeadquartersSchema = z.object({ communityId: z.string().min(1) });

// PUT /api/admin/communities/headquarters — designates (or re-designates)
// the single National Headquarters Community. Purely updates the Settings
// singleton pointer: never touches Community.parentId, never creates or
// moves any Community. Server-authoritative — only an existing, ROOT
// (parentId === null) Community may be designated, never trusted from the
// client beyond the id itself.
//
// Deliberately does NOT require `active: true`: no other route in this
// codebase treats Community.active as an eligibility gate for anything (it
// is a display-only toggle everywhere it's used — confirmed by inspection
// before this phase) — inventing that requirement here, with no existing
// precedent, would be exactly the kind of speculative rule this phase was
// told not to add.
router.put('/headquarters', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = designateHeadquartersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'A communityId is required.' });
  }

  const community = await prisma.community.findUnique({ where: { id: parsed.data.communityId } });
  if (!community) {
    return res.status(400).json({ error: 'Community not found.' });
  }
  if (community.parentId !== null) {
    return res.status(400).json({ error: 'Only a root Community (no parent) may be designated as National Headquarters.' });
  }

  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', headquartersCommunityId: community.id },
    update: { headquartersCommunityId: community.id },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'HEADQUARTERS_COMMUNITY_DESIGNATED',
    targetType: 'Community',
    targetId: community.id,
    metadata: { name: community.name },
  });

  res.json({ community: { id: community.id, name: community.name } });
}));

const replaceHeadquartersSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Whether the new top assembly itself receives automatically-placed
  // newcomers (the old Headquarters and everything under it are untouched).
  autoPlacementEligible: z.boolean().default(false),
  // The assemblies that sit directly under the old Headquarters move up, to sit directly under the new one beside it
  // (their own sub-assemblies go with them), instead of staying under the old Headquarters.
  moveSubAssembliesUp: z.boolean().default(false),
  // Newcomers are placed only in the new Headquarters (until it is full and the app opens assemblies under it): every
  // other assembly keeps its members but stops receiving newcomers. Implies the new assembly receives them.
  closeOthersToNewcomers: z.boolean().default(false),
});

// POST /api/admin/communities/headquarters/replace — one step for "a new
// assembly becomes the Headquarters and the current one goes under it":
// creates the new top-level assembly, moves the current Headquarters (with
// everything below it) under the new one, and points the Headquarters
// designation at the new one — all in one transaction, so the tree is never
// half-changed. Nobody's membership, chat or history is touched.
router.post('/headquarters/replace', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = replaceHeadquartersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'A name is required.' });
  }
  const oldId = await getHeadquartersCommunityId();
  if (!oldId) {
    return res.status(400).json({ error: 'No National Headquarters has been designated yet, so there is nothing to replace.' });
  }
  const old = await prisma.community.findUnique({ where: { id: oldId }, select: { id: true, name: true } });
  if (!old) return res.status(400).json({ error: 'The current Headquarters could not be found.' });

  const { moveSubAssembliesUp, closeOthersToNewcomers } = parsed.data;
  // Worked out before anything changes: the old Headquarters and everything under it.
  const oldTree = closeOthersToNewcomers ? await getDescendantCommunityIds(old.id) : [];
  const eligible = parsed.data.autoPlacementEligible || closeOthersToNewcomers;

  const created = await prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: { name: parsed.data.name, parentId: null, autoPlacementEligible: eligible },
    });
    await tx.conversation.create({ data: { communityId: community.id } });
    // The assemblies directly under the old Headquarters, taken before it moves.
    if (moveSubAssembliesUp) await tx.community.updateMany({ where: { parentId: old.id }, data: { parentId: community.id } });
    // The old Headquarters becomes a group of the new one (the Leadership Team): not a generation, no newcomers.
    await tx.community.update({ where: { id: old.id }, data: { parentId: community.id, kind: 'GROUP', autoPlacementEligible: false } });
    await tx.settings.update({ where: { id: 'singleton' }, data: { headquartersCommunityId: community.id } });
    if (closeOthersToNewcomers && oldTree.length > 0) await tx.community.updateMany({ where: { id: { in: oldTree } }, data: { autoPlacementEligible: false } });
    return community;
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'HEADQUARTERS_COMMUNITY_REPLACED',
    targetType: 'Community',
    targetId: created.id,
    metadata: { name: created.name, previousHeadquartersId: old.id, previousHeadquartersName: old.name, autoPlacementEligible: created.autoPlacementEligible, moveSubAssembliesUp, closeOthersToNewcomers },
  });

  res.status(201).json({ community: { id: created.id, name: created.name }, previous: old });
}));

// GET/PUT /api/admin/communities/placement-settings — how newly signed-up
// members are placed into groups (see lib/placement.ts). Registered before
// /:id so "placement-settings" is never captured as a Community id.
router.get('/placement-settings', asyncHandler(async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { placementMode: true, assemblyCapacity: true } });
  res.json({ placementMode: settings?.placementMode ?? 'SMALLEST_GROUP', assemblyCapacity: settings?.assemblyCapacity ?? 200 });
}));

// assemblyCapacity: how many members an assembly holds before new members go
// to a new child assembly (see lib/placement.ts). Optional so the older
// "mode only" request still works.
const placementSettingsSchema = z.object({
  placementMode: z.enum(['SMALLEST_GROUP', 'BY_LOCATION']),
  assemblyCapacity: z.number().int().min(10).max(5000).optional(),
});

router.put('/placement-settings', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = placementSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'placementMode must be SMALLEST_GROUP or BY_LOCATION, and assemblyCapacity a whole number from 10 to 5000.' });
  }
  const { placementMode, assemblyCapacity } = parsed.data;
  const saved = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', placementMode, ...(assemblyCapacity !== undefined ? { assemblyCapacity } : {}) },
    update: { placementMode, ...(assemblyCapacity !== undefined ? { assemblyCapacity } : {}) },
    select: { assemblyCapacity: true },
  });
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'PLACEMENT_MODE_UPDATED',
    targetType: 'Settings',
    targetId: 'singleton',
    metadata: { placementMode, assemblyCapacity: saved.assemblyCapacity },
  });
  res.json({ placementMode, assemblyCapacity: saved.assemblyCapacity });
}));

// GET /api/admin/communities/export — CSV export of every CommunityMembership
// row, network-wide. Registered BEFORE /:id so "export" is never captured as
// a Community id. Minimum-necessary fields only (Person name/id, Community
// name/id, membership status, joinedAt) — deliberately excludes WhatsApp,
// email, DOB, location, photo, notes, and every other Person field, matching
// this codebase's established "minimum necessary" convention for any export
// or report surface (see the Follow-Up Attention and Notifications phases).
// Follows the exact manual-CSV-builder pattern already established by
// GET /api/admin/export (registrations) — no new CSV library.
router.get('/export', asyncHandler(async (req, res) => {
  const memberships = await prisma.communityMembership.findMany({
    include: {
      person: { select: { id: true, name: true } },
      community: { select: { id: true, name: true } },
    },
    orderBy: { joinedAt: 'desc' },
    take: 5000,
  });

  const header = 'personName,personId,communityName,communityId,status,joinedAt\n';
  const rows = memberships
    .map((m) =>
      [
        JSON.stringify(m.person.name),
        m.personId,
        JSON.stringify(m.community.name),
        m.communityId,
        m.status,
        m.joinedAt.toISOString(),
      ].join(','),
    )
    .join('\n');

  // Audit metadata records that an export happened and how large it was —
  // never the exported rows themselves (no Person/Community names or ids in
  // metadata), matching the instruction to identify the export without
  // storing the exported personal data in the audit entry.
  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_MEMBERSHIPS_EXPORTED',
    targetType: 'CommunityMembership',
    metadata: { rowCount: memberships.length },
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="community-memberships.csv"');
  res.send(header + rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [node, headquartersId] = await Promise.all([
    prisma.community.findUnique({
      where: { id: req.params.id },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, memberships: true } },
      },
    }),
    getHeadquartersCommunityId(),
  ]);
  if (!node) return res.status(404).json({ error: 'Community not found.' });
  const generation = headquartersId ? await getCommunityGeneration(node.id, headquartersId) : null;
  res.json({ ...node, generation });
}));

// GET /api/admin/communities/:id/members — paginated CommunityMembership
// rows for this community, with a light Person summary per row.
router.get('/:id/members', asyncHandler(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });

  const { page, pageSize, skip, take } = parsePagination(req);
  const [total, memberships] = await Promise.all([
    prisma.communityMembership.count({ where: { communityId: req.params.id } }),
    prisma.communityMembership.findMany({
      where: { communityId: req.params.id },
      include: { person: { select: { id: true, name: true, whatsappNumber: true } } },
      orderBy: { joinedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(memberships, total, page, pageSize));
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // ASSEMBLY (default) counts as a generation; GROUP (women, youth, prayer…) belongs to an assembly and never does.
  kind: z.enum(['ASSEMBLY', 'GROUP']).optional(),
  parentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
  // Whether this new group should receive automatically-placed newcomers.
  // Defaults to true (a fresh, childless group behaves as open unless
  // Admin explicitly turns it off for a special-purpose sub-group).
  autoPlacementEligible: z.boolean().optional(),
  // Optional location tag for BY_LOCATION placement. Blank clears it.
  placementCountry: z.string().trim().max(100).optional().nullable().transform((v) => (v === undefined ? undefined : v ? v : null)),
  placementRegion: z.string().trim().max(100).optional().nullable().transform((v) => (v === undefined ? undefined : v ? v : null)),
});

router.post('/', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid community.' });
  }
  const d = parsed.data;

  const kind = d.kind ?? 'ASSEMBLY';
  if (kind === 'GROUP' && !d.parentId) return res.status(400).json({ error: 'A group belongs to an assembly: choose which one.' });
  if (d.parentId) {
    const parent = await prisma.community.findUnique({ where: { id: d.parentId }, select: { id: true, kind: true } });
    if (!parent) return res.status(400).json({ error: 'Parent community not found.' });
    if (kind === 'ASSEMBLY' && parent.kind === 'GROUP') {
      return res.status(400).json({ error: 'An assembly of the next generation must sit under an assembly, not under a group.' });
    }
  }

  // Phase 3M.1: every Community gets its one Conversation eagerly, in the
  // same transaction as its own creation — Conversation.communityId's
  // unique constraint guarantees this can never produce more than one.
  const created = await prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: {
        name: d.name,
        kind,
        parentId: d.parentId ?? null,
        active: d.active ?? true,
        // A group never receives newcomers automatically.
        autoPlacementEligible: kind === 'GROUP' ? false : d.autoPlacementEligible ?? true,
        placementCountry: d.placementCountry ?? null,
        placementRegion: d.placementRegion ?? null,
      },
    });
    await tx.conversation.create({ data: { communityId: community.id } });
    return community;
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_CREATED',
    targetType: 'Community',
    targetId: created.id,
    metadata: { name: created.name, parentId: created.parentId, kind: created.kind },
  });

  res.status(201).json(created);
}));

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['ASSEMBLY', 'GROUP']).optional(),
  parentId: z.string().optional().nullable(),
  active: z.boolean().optional(),
  autoPlacementEligible: z.boolean().optional(),
  // Community Posting Policy — validated against exactly these two values;
  // an arbitrary string is rejected at this layer, never reaching Prisma.
  postingPolicy: z.enum(['EVERYONE', 'LEADERS_ONLY']).optional(),
  // Optional location tag for BY_LOCATION placement. Blank clears it.
  placementCountry: z.string().trim().max(100).optional().nullable().transform((v) => (v === undefined ? undefined : v ? v : null)),
  placementRegion: z.string().trim().max(100).optional().nullable().transform((v) => (v === undefined ? undefined : v ? v : null)),
});

router.patch('/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const existing = await prisma.community.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Community not found.' });

  // Assembly or group: only assemblies count as generations.
  const newKind = d.kind ?? existing.kind;
  const newParentId = d.parentId !== undefined ? d.parentId : existing.parentId;
  const headquartersId = await getHeadquartersCommunityId();
  if (newKind === 'GROUP') {
    if (id === headquartersId) return res.status(400).json({ error: 'The Headquarters is an assembly, not a group.' });
    if (!newParentId) return res.status(400).json({ error: 'A group belongs to an assembly: choose which one.' });
    if (d.kind === 'GROUP' && existing.kind === 'ASSEMBLY' && (await prisma.community.count({ where: { parentId: id, kind: 'ASSEMBLY' } })) > 0) {
      return res.status(400).json({ error: 'This assembly has assemblies of the next generation under it, so it cannot become a group.' });
    }
  } else if (newParentId) {
    const parentKind = (await prisma.community.findUnique({ where: { id: newParentId }, select: { kind: true } }))?.kind;
    if (parentKind === 'GROUP') return res.status(400).json({ error: 'An assembly of the next generation must sit under an assembly, not under a group.' });
  }

  if (d.parentId !== undefined && d.parentId !== null) {
    if (d.parentId === id) {
      return res.status(400).json({ error: 'A community cannot be its own parent.' });
    }
    const newParent = await prisma.community.findUnique({ where: { id: d.parentId } });
    if (!newParent) return res.status(400).json({ error: 'Parent community not found.' });
    const cycle = await wouldCreateCycle(
      (nid) => prisma.community.findUnique({ where: { id: nid }, select: { id: true, parentId: true } }),
      id,
      d.parentId,
    );
    if (cycle) {
      return res.status(400).json({ error: 'This would make the community a descendant of itself.' });
    }
  }

  const updated = await prisma.community.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.kind !== undefined ? { kind: d.kind, ...(d.kind === 'GROUP' ? { autoPlacementEligible: false } : {}) } : {}),
      ...(d.parentId !== undefined ? { parentId: d.parentId } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.autoPlacementEligible !== undefined ? { autoPlacementEligible: d.autoPlacementEligible } : {}),
      ...(d.postingPolicy !== undefined ? { postingPolicy: d.postingPolicy } : {}),
      ...(d.placementCountry !== undefined ? { placementCountry: d.placementCountry } : {}),
      ...(d.placementRegion !== undefined ? { placementRegion: d.placementRegion } : {}),
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_UPDATED',
    targetType: 'Community',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

// What deleting this assembly would remove — shown to the admin before they
// confirm. Counts only; nothing changes.
async function deletionImpact(id: string) {
  const [members, subAssemblies, messages, teachings, events] = await Promise.all([
    prisma.communityMembership.count({ where: { communityId: id } }),
    prisma.community.count({ where: { parentId: id } }),
    prisma.message.count({ where: { conversation: { communityId: id } } }),
    prisma.teaching.count({ where: { communityId: id } }),
    prisma.assemblyEvent.count({ where: { communityId: id } }),
  ]);
  return { members, subAssemblies, messages, teachings, events };
}

// GET /api/admin/communities/:id/delete-impact
router.get('/:id/delete-impact', asyncHandler(async (req, res) => {
  const node = await prisma.community.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
  if (!node) return res.status(404).json({ error: 'Community not found.' });
  const headquartersId = await getHeadquartersCommunityId();
  res.json({ id: node.id, name: node.name, isHeadquarters: node.id === headquartersId, ...(await deletionImpact(node.id)) });
}));

const deleteSchema = z.object({
  // The admin must type the assembly's name to confirm.
  confirmName: z.string().trim().min(1, 'Type the assembly name to confirm.'),
  // What to do with assemblies directly under it. Required when there are any.
  subAssemblies: z.enum(['moveUp']).optional(),
  // Where its members go. Without it they simply leave this assembly (and stay in any others).
  moveMembersTo: z.string().min(1).optional(),
});

// DELETE /api/admin/communities/:id — permanently removes one assembly with
// its group chat, memberships, teachings and events. The people themselves
// are never deleted (they only leave this assembly). The Headquarters cannot
// be deleted, and assemblies under it must be moved up first.
router.delete('/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = deleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const existing = await prisma.community.findUnique({ where: { id }, select: { id: true, name: true, parentId: true } });
  if (!existing) return res.status(404).json({ error: 'Community not found.' });

  const headquartersId = await getHeadquartersCommunityId();
  if (existing.id === headquartersId) {
    return res.status(400).json({ error: 'This is the Headquarters and cannot be deleted. Replace the Headquarters first if you need a different one.' });
  }
  if (parsed.data.confirmName.trim().toLowerCase() !== existing.name.trim().toLowerCase()) {
    return res.status(400).json({ error: 'The name you typed does not match this assembly.' });
  }

  const impact = await deletionImpact(id);
  if (impact.subAssemblies > 0 && parsed.data.subAssemblies !== 'moveUp') {
    return res.status(409).json({
      error: `This assembly has ${impact.subAssemblies} assembl${impact.subAssemblies === 1 ? 'y' : 'ies'} under it. Choose what happens to them first.`,
      code: 'HAS_SUB_ASSEMBLIES',
      subAssemblies: impact.subAssemblies,
    });
  }

  let membersMoved: { destinationName: string; added: number; alreadyIn: number } | undefined;
  if (parsed.data.moveMembersTo) {
    if (parsed.data.moveMembersTo === id) return res.status(400).json({ error: 'Members cannot be moved into the assembly being deleted.' });
    const destination = await prisma.community.findUnique({ where: { id: parsed.data.moveMembersTo }, select: { id: true, name: true } });
    if (!destination) return res.status(400).json({ error: 'The assembly to move the members to was not found.' });
    const members = await prisma.communityMembership.findMany({ where: { communityId: id, status: 'ACTIVE' }, select: { personId: true } });
    const moved = await addPeopleToCommunity(members.map((m) => m.personId), destination.id);
    await notifyAddedToAssembly(moved.addedIds, destination).catch(() => {});
    membersMoved = { destinationName: destination.name, added: moved.added, alreadyIn: moved.alreadyIn };
  }

  await prisma.$transaction(async (tx) => {
    // Assemblies under it step up to its own parent (or become top-level).
    if (impact.subAssemblies > 0) {
      await tx.community.updateMany({ where: { parentId: id }, data: { parentId: existing.parentId } });
    }
    await tx.community.delete({ where: { id } });
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMUNITY_DELETED',
    targetType: 'Community',
    targetId: id,
    metadata: { name: existing.name, ...impact, membersMoved, movedSubAssembliesTo: impact.subAssemblies > 0 ? existing.parentId : undefined },
  });

  res.json({ deleted: true, name: existing.name, ...impact, membersMoved });
}));

return router;
}

const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'), buildCommunitiesRouter());

export default adminRouter;

// The central admin's member profile: the same tools, signed in as the member profile linked to the admin account.
export const memberCentralCommunitiesRoutes = (() => {
  const router = Router();
  router.use(requireMember);
  router.use(
    asyncHandler(async (req, res, next) => {
      if (!(await isCentralAdminPerson(req.member!.personId))) return res.status(403).json({ error: 'Forbidden.' });
      const user = await prisma.user.findUnique({ where: { personId: req.member!.personId }, select: { id: true, email: true, role: true, active: true, personId: true, name: true } });
      if (!user || user.role !== 'ADMIN' || !user.active) return res.status(403).json({ error: 'Forbidden.' });
      (req as any).user = user;
      next();
    }),
  );
  router.use(buildCommunitiesRouter());
  return router;
})();
