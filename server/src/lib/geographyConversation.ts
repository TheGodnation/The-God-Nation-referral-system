import { prisma } from './prisma';
import { findActiveScopedRole } from './leadership';
import { getDescendantGeographyIds } from './tree';

/**
 * Phase 3M.6 — authorization for a Geography's two-way group conversation.
 * Deliberately its own helper, not a reuse of:
 *  - communityConversation.ts's hasConversationAccess (a different
 *    Community-only relationship);
 *  - lib/leadership.ts's isGeographyInLeaderScope (answers a Leader's own
 *    ROSTER-visibility reach — "can this Leader see a descendant node's
 *    roster" — a completely different question from "who may participate
 *    in this exact node's conversation");
 *  - lib/announcements.ts's personMatchesTargets (a similar-shaped
 *    descendant check, but for one-way announcement audience, not two-way
 *    conversation membership — kept structurally separate on purpose, the
 *    same way Phase 3M.3 kept its own geography check separate from
 *    Phase 3K's).
 *
 * Two independent ways to qualify for Geography G's conversation, checked
 * fresh on every call (never cached, never persisted):
 *
 * 1. ORDINARY PERSON — their own current ACTIVE GeographicAssignment is G
 *    itself, or a descendant of G. A person living in a Quarter can join
 *    that Quarter's conversation and every ancestor's (their Division,
 *    Region, Country, ...), because their one fixed home node is a
 *    descendant of each of those. They can NOT join a conversation for a
 *    node that is itself a descendant of their home node (e.g. a Douala
 *    resident cannot join one specific Quarter's conversation) — the same
 *    node-or-descendant rule already established for announcement Geography
 *    targeting (lib/announcements.ts), reused here via the same pure
 *    tree-traversal utility, getDescendantGeographyIds.
 *
 * 2. GEOGRAPHICAL LEADER — an ACTIVE SCOPED_LEADER RoleAssignment for
 *    EXACTLY G (via findActiveScopedRole, which is already exact-match —
 *    never isGeographyInLeaderScope's descendant-aware roster check). A
 *    Leader scoped to a descendant of G does NOT automatically gain access
 *    to G's conversation, and a Leader scoped to an ancestor of G does NOT
 *    automatically gain access to G's conversation either — leadership
 *    authority here is exact-match only, exactly like every other
 *    RoleAssignment-gated action in this codebase (Follow-Up creation,
 *    Community Conversation's own leader check).
 *
 * Admin is never a participant: there is no Admin conversation-browsing
 * route in this phase, matching Phase 3M.1/3M.2's own precedent.
 */
export async function canAccessGeographyConversation(personId: string, geographyId: string): Promise<boolean> {
  const [assignment, leaderRole] = await Promise.all([
    prisma.geographicAssignment.findUnique({ where: { personId } }),
    findActiveScopedRole(personId, 'GEOGRAPHY', geographyId),
  ]);

  if (leaderRole) return true;

  if (assignment && assignment.status === 'ACTIVE') {
    const descendants = await getDescendantGeographyIds(geographyId);
    if (descendants.includes(assignment.geographyId)) return true;
  }

  return false;
}

/**
 * Every Geography has at most one GeographyConversation
 * (GeographyConversation.geographyId is unique). Unlike Community
 * Conversation's eager creation (one per Community, created in the same
 * transaction as the Community itself — a small, curated set), Geography
 * Conversations are created lazily, on first access: the Geography tree is
 * far larger and deeper (every Country/Region/Division/Sub-Division/
 * Quarter/Village), and most nodes will never need a conversation. `upsert`
 * makes this race-safe under the same unique constraint, so concurrent
 * callers can never create two.
 */
export async function getOrCreateGeographyConversation(geographyId: string) {
  return prisma.geographyConversation.upsert({
    where: { geographyId },
    create: { geographyId },
    update: {},
  });
}
