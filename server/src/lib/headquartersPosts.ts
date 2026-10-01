import { prisma } from './prisma';
import { getDescendantCommunityIds, getHeadquartersCommunityId } from './tree';
import type { HeadquartersPost } from '@prisma/client';

/**
 * Headquarters Network Posts — audience/authorization/engagement logic for
 * the HeadquartersPost/HeadquartersPostTarget/HeadquartersPostComment/
 * HeadquartersPostReaction family. Kept entirely separate from
 * lib/announcements.ts (its own, structurally distinct feature) and from
 * lib/leadership.ts — only the plain tree-traversal utilities in lib/tree.ts
 * are reused, the same "two unrelated features can both use a sorting
 * function" precedent already established by announcements.ts's own reuse
 * of getDescendantGeographyIds.
 *
 * See HeadquartersPost's schema comment for the exact two-mode audience
 * design (networkWide vs exact-match selected-Community targets) — this
 * module is the one place that design is actually evaluated.
 */

type TargetRow = { communityId: string };

// Media Phase 1 — metadata only (see adminHeadquartersPosts.ts/
// headquartersPosts.ts's own toMediaResponse/toRecipientResponse): a
// storageKey is never selected here, so it can never leak into a recipient
// response even by accident.
type MediaRow = { id: string; originalFilename: string; mimeType: string; byteSize: number; mediaType: string } | null;

/**
 * Whether personId qualifies for post's audience, using only live,
 * server-side organizational data (never a persisted recipient list).
 * networkWide posts are computed against the current Headquarters
 * Community tree (getDescendantCommunityIds) on every call — never cached
 * beyond the lifetime of one computation — so a Community added to the tree
 * after publish is included immediately, and one removed drops out
 * immediately, with no backfill/migration step of any kind.
 */
export async function personMatchesHeadquartersPost(
  personId: string,
  post: { networkWide: boolean; targets: TargetRow[] },
): Promise<boolean> {
  if (post.networkWide) {
    const headquartersCommunityId = await getHeadquartersCommunityId();
    if (!headquartersCommunityId) return false;
    const treeIds = await getDescendantCommunityIds(headquartersCommunityId);
    const membership = await prisma.communityMembership.findFirst({
      where: { personId, status: 'ACTIVE', communityId: { in: treeIds } },
      select: { id: true },
    });
    return Boolean(membership);
  }

  const targetCommunityIds = post.targets.map((t) => t.communityId);
  if (targetCommunityIds.length === 0) return false;

  const membership = await prisma.communityMembership.findFirst({
    where: { personId, status: 'ACTIVE', communityId: { in: targetCommunityIds } },
    select: { id: true },
  });
  return Boolean(membership);
}

/**
 * Whether personId may currently view headquartersPostId: it must exist, be
 * published, not be archived, and the Person must match its audience.
 * Returns false (never throws) for a nonexistent id, so callers can respond
 * 404 uniformly regardless of which check failed.
 */
export async function personCanViewHeadquartersPost(personId: string, headquartersPostId: string): Promise<boolean> {
  const post = await prisma.headquartersPost.findUnique({
    where: { id: headquartersPostId },
    include: { targets: { select: { communityId: true } } },
  });
  if (!post) return false;
  if (!post.publishedAt) return false;
  if (post.archivedAt) return false;
  return personMatchesHeadquartersPost(personId, post);
}

/**
 * Every published, non-archived HeadquartersPost personId currently
 * qualifies for, ordered publishedAt DESC. Derived fresh on every call.
 */
export async function computeVisibleHeadquartersPostsForPerson(
  personId: string,
): Promise<(HeadquartersPost & { targets: TargetRow[]; media: MediaRow })[]> {
  const [memberships, headquartersCommunityId] = await Promise.all([
    prisma.communityMembership.findMany({
      where: { personId, status: 'ACTIVE' },
      select: { communityId: true },
    }),
    getHeadquartersCommunityId(),
  ]);
  const communityIds = new Set(memberships.map((m) => m.communityId));

  let treeIds: Set<string> | null = null;
  if (headquartersCommunityId) {
    treeIds = new Set(await getDescendantCommunityIds(headquartersCommunityId));
  }

  const posts = await prisma.headquartersPost.findMany({
    where: { publishedAt: { not: null }, archivedAt: null },
    include: {
      targets: { select: { communityId: true } },
      media: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, mediaType: true } },
    },
    orderBy: { publishedAt: 'desc' },
  });

  const eligible: (HeadquartersPost & { targets: TargetRow[]; media: MediaRow })[] = [];
  for (const post of posts) {
    if (post.networkWide) {
      if (treeIds && [...communityIds].some((id) => treeIds!.has(id))) {
        eligible.push(post);
      }
      continue;
    }
    if (post.targets.some((t) => communityIds.has(t.communityId))) {
      eligible.push(post);
    }
  }
  return eligible;
}

/**
 * Confirms every referenced Community id in a proposed target list actually
 * exists. A client-supplied id is never trusted merely because it was
 * accepted once before — used at both draft-edit time and again at publish
 * time (defensive re-validation), mirroring
 * lib/announcements.ts's validateTargetReferences.
 */
export async function validateCommunityTargetReferences(communityIds: string[]): Promise<boolean> {
  if (communityIds.length === 0) return true;
  const count = await prisma.community.count({ where: { id: { in: communityIds } } });
  return count === new Set(communityIds).size;
}

/**
 * Batch engagement counts (comment count, reaction count, and whether
 * personId has reacted) for a set of HeadquartersPost ids — one query per
 * count regardless of how many ids are passed, never one query per post.
 */
export async function getHeadquartersPostEngagementCounts(
  headquartersPostIds: string[],
  personId: string,
): Promise<Map<string, { commentCount: number; reactionCount: number; viewerHasReacted: boolean }>> {
  const result = new Map<string, { commentCount: number; reactionCount: number; viewerHasReacted: boolean }>();
  if (headquartersPostIds.length === 0) return result;

  const [commentGroups, reactionGroups, viewerReactions] = await Promise.all([
    prisma.headquartersPostComment.groupBy({
      by: ['headquartersPostId'],
      where: { headquartersPostId: { in: headquartersPostIds } },
      _count: { _all: true },
    }),
    prisma.headquartersPostReaction.groupBy({
      by: ['headquartersPostId'],
      where: { headquartersPostId: { in: headquartersPostIds } },
      _count: { _all: true },
    }),
    prisma.headquartersPostReaction.findMany({
      where: { headquartersPostId: { in: headquartersPostIds }, personId },
      select: { headquartersPostId: true },
    }),
  ]);

  const commentCounts = new Map(commentGroups.map((g) => [g.headquartersPostId, g._count._all]));
  const reactionCounts = new Map(reactionGroups.map((g) => [g.headquartersPostId, g._count._all]));
  const viewerReacted = new Set(viewerReactions.map((r) => r.headquartersPostId));

  for (const id of headquartersPostIds) {
    result.set(id, {
      commentCount: commentCounts.get(id) ?? 0,
      reactionCount: reactionCounts.get(id) ?? 0,
      viewerHasReacted: viewerReacted.has(id),
    });
  }
  return result;
}
