import { prisma } from './prisma';
import type { PrivateMessagingActor } from './privateMessaging';

// In-App Notifications Foundation — exactly the four supported events
// (see schema.prisma's own NotificationType comment). No message text is
// ever persisted: only `type` and a small `metadata` JSON bag (names only)
// are stored, so the client can render its own localized message via the
// existing i18n convention — a server-rendered English/French string would
// defeat that. Each helper below is called exactly once, immediately after
// the single Prisma `create()` call for the underlying event's own record,
// so exactly one Notification results per event — never duplicated by a
// retry, since none of those call sites retry their own create.

interface CreateNotificationParams {
  recipientPersonId?: string;
  recipientUserId?: string;
  type: 'FOLLOW_UP_ASSIGNED' | 'PRIVATE_MESSAGE_RECEIVED' | 'RESOURCE_GRANTED' | 'ROLE_ASSIGNED';
  metadata?: Record<string, unknown>;
  targetType?: string;
  targetId?: string;
}

async function createNotification(params: CreateNotificationParams) {
  return prisma.notification.create({
    data: {
      recipientPersonId: params.recipientPersonId ?? null,
      recipientUserId: params.recipientUserId ?? null,
      type: params.type,
      metadata: (params.metadata ?? undefined) as any,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
    },
  });
}

/** Event 1 — a Leader receives a new Follow-Up assignment. Fires for every
 * new ACTIVE FollowUpAssignment row regardless of who created it (Admin,
 * the Leader's own self-service creation, or a reassignment) — the
 * recipient is always the assignment's own followerId, matching this
 * codebase's existing "the data itself is the source of truth" convention
 * (see lib/leadership.ts). */
export async function notifyFollowUpAssigned(assignment: { id: string; followerId: string; followedPersonId: string }) {
  const followedPerson = await prisma.person.findUnique({
    where: { id: assignment.followedPersonId },
    select: { name: true },
  });
  await createNotification({
    recipientPersonId: assignment.followerId,
    type: 'FOLLOW_UP_ASSIGNED',
    metadata: { followedPersonName: followedPerson?.name ?? '' },
    targetType: 'FollowUpAssignment',
    targetId: assignment.id,
  });
}

/** Event 4 — a Leader receives a new Community leadership assignment.
 * Fires only when communityId is set (it always is for a newly created
 * RoleAssignment — see adminLeadership.ts's own createRoleAssignmentSchema —
 * this guard is defensive only). */
export async function notifyRoleAssigned(roleAssignment: { id: string; personId: string; communityId: string | null }) {
  if (!roleAssignment.communityId) return;
  const community = await prisma.community.findUnique({
    where: { id: roleAssignment.communityId },
    select: { name: true },
  });
  await createNotification({
    recipientPersonId: roleAssignment.personId,
    type: 'ROLE_ASSIGNED',
    metadata: { communityName: community?.name ?? '' },
    targetType: 'RoleAssignment',
    targetId: roleAssignment.id,
  });
}

/** Event 3 — a Member receives a Resource grant. */
export async function notifyResourceGranted(grant: { id: string; personId: string; resourceId: string }) {
  const resource = await prisma.resource.findUnique({
    where: { id: grant.resourceId },
    select: { titleEn: true, titleFr: true },
  });
  await createNotification({
    recipientPersonId: grant.personId,
    type: 'RESOURCE_GRANTED',
    metadata: {
      resourceTitleEn: resource?.titleEn ?? '',
      resourceTitleFr: resource?.titleFr ?? resource?.titleEn ?? '',
    },
    targetType: 'ResourceAccessGrant',
    targetId: grant.id,
  });
}

/** Event 2 — a user receives a new private message. The recipient is
 * whichever side of the conversation did NOT send this message: if the
 * Member sent it, the recipient is the conversation's own initiator
 * (a Leader's Person, or an Admin's User — the same identity-duality this
 * conversation itself already carries); if the organizational side sent
 * it, the recipient is always the Member (memberPersonId, always a Person).
 * `senderName` is null for a Central-Authority (Admin) sender — mirroring
 * privateMessages.ts's own resolveOtherParty CENTRAL_AUTHORITY convention —
 * so the client renders its own generic, translated label instead of a
 * stored, unlocalized name. */
export async function notifyPrivateMessageReceived(
  conversation: { id: string; memberPersonId: string; initiatorUserId: string | null; initiatorPersonId: string | null },
  sender: PrivateMessagingActor,
) {
  const senderIsMember = sender.type === 'PERSON' && sender.personId === conversation.memberPersonId;

  let recipientPersonId: string | undefined;
  let recipientUserId: string | undefined;
  let senderName: string | null;

  if (senderIsMember) {
    if (conversation.initiatorPersonId) {
      recipientPersonId = conversation.initiatorPersonId;
    } else if (conversation.initiatorUserId) {
      recipientUserId = conversation.initiatorUserId;
    } else {
      return; // Unreachable given the schema's own exclusivity CHECK constraint.
    }
    const member = await prisma.person.findUnique({ where: { id: conversation.memberPersonId }, select: { name: true } });
    senderName = member?.name ?? '';
  } else {
    recipientPersonId = conversation.memberPersonId;
    if (sender.type === 'PERSON') {
      const leader = await prisma.person.findUnique({ where: { id: sender.personId }, select: { name: true } });
      senderName = leader?.name ?? '';
    } else {
      senderName = null; // Central Authority — client shows its own generic label.
    }
  }

  await createNotification({
    recipientPersonId,
    recipientUserId,
    type: 'PRIVATE_MESSAGE_RECEIVED',
    metadata: { senderName },
    targetType: 'PrivateConversation',
    targetId: conversation.id,
  });
}
