import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Phase 3I — Follow-Up Attention Surfacing. A read-only derived-data layer
// over the existing Phase 3D FollowUpAssignment/FollowUpContact tables — no
// new model, column, or persisted "attention" flag. Every value here is
// computed fresh from the latest FollowUpContact on each call, following the
// same "derive, don't persist" pattern as lib/trainingProgress.ts.
// ---------------------------------------------------------------------------

export type AttentionReason = 'EMERGENCY' | 'NEEDS_ATTENTION' | 'UNABLE_TO_REACH' | 'OVERDUE' | 'NOT_YET_CONTACTED';

export interface AttentionItem {
  followUpAssignmentId: string;
  personId: string;
  name: string;
  reason: AttentionReason;
  lastContactedAt: Date | null;
  nextFollowUpDate: Date | null;
  assignedAt: Date;
}

const REASON_PRIORITY: Record<AttentionReason, number> = {
  EMERGENCY: 0,
  NEEDS_ATTENTION: 1,
  UNABLE_TO_REACH: 2,
  OVERDUE: 3,
  NOT_YET_CONTACTED: 4,
};

interface LatestContact {
  wellbeingStatus: 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH';
  contactedAt: Date;
  nextFollowUpDate: Date | null;
}

/**
 * The fixed, non-configurable classification rule for one ACTIVE assignment,
 * given only its latest FollowUpContact (by contactedAt). Because only the
 * latest contact is ever considered, an older contact's wellbeing status or
 * nextFollowUpDate can never surface here — a newer GOOD contact always
 * supersedes an older EMERGENCY one, and a newer contact's own
 * nextFollowUpDate (or absence of one) always supersedes an older contact's
 * schedule. Returns null when the assignment needs no attention.
 */
function classify(latest: LatestContact | null, now: Date): AttentionReason | null {
  if (!latest) return 'NOT_YET_CONTACTED';
  if (latest.wellbeingStatus === 'EMERGENCY') return 'EMERGENCY';
  if (latest.wellbeingStatus === 'NEEDS_ATTENTION') return 'NEEDS_ATTENTION';
  if (latest.wellbeingStatus === 'UNABLE_TO_REACH') return 'UNABLE_TO_REACH';
  if (latest.nextFollowUpDate && latest.nextFollowUpDate.getTime() < now.getTime()) return 'OVERDUE';
  return null;
}

/**
 * Every ACTIVE FollowUpAssignment for the given follower Person that
 * currently needs attention, in fixed priority order (EMERGENCY first, then
 * NEEDS_ATTENTION, UNABLE_TO_REACH, OVERDUE, NOT_YET_CONTACTED), tied by the
 * assignment's assignedAt (oldest first). CLOSED assignments are never
 * considered. Used by GET /api/leader/follow-ups/attention only — there is
 * deliberately no Admin equivalent in this phase.
 */
export async function computeAttentionForLeader(followerId: string): Promise<AttentionItem[]> {
  const assignments = await prisma.followUpAssignment.findMany({
    where: { followerId, status: 'ACTIVE' },
    include: {
      followedPerson: { select: { id: true, name: true } },
      contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
    },
  });

  const now = new Date();
  const items: AttentionItem[] = [];
  for (const a of assignments) {
    const latest = a.contacts[0] ?? null;
    const reason = classify(latest, now);
    if (!reason) continue;
    items.push({
      followUpAssignmentId: a.id,
      personId: a.followedPerson.id,
      name: a.followedPerson.name,
      reason,
      lastContactedAt: latest?.contactedAt ?? null,
      nextFollowUpDate: latest?.nextFollowUpDate ?? null,
      assignedAt: a.assignedAt,
    });
  }

  items.sort((x, y) => {
    const byPriority = REASON_PRIORITY[x.reason] - REASON_PRIORITY[y.reason];
    return byPriority !== 0 ? byPriority : x.assignedAt.getTime() - y.assignedAt.getTime();
  });

  return items;
}
