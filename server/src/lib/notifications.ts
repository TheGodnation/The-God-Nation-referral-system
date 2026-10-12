import { prisma } from './prisma';
import type { PrivateMessagingActor } from './privateMessaging';
import { pushToPerson, pushToUser, pushToPersons, type PushPayload } from './push';

// In-App Notifications Foundation (see schema.prisma's own NotificationType
// comment). No message text is ever persisted: only `type` and a small
// `metadata` JSON bag (names only) are stored, so the client can render its
// own localized message via the existing i18n convention — a
// server-rendered English/French string would defeat that. Each
// single-recipient helper below is called exactly once, immediately after
// the single Prisma `create()` call for the underlying event's own record,
// so exactly one Notification results per event — never duplicated by a
// retry, since none of those call sites retry their own create.
//
// Phase 5 — every helper now also fires a best-effort Web Push alongside
// the in-app row (see lib/push.ts): closed-app delivery is the whole point
// of removing the mute option, since an in-app-only row does nothing for a
// Member who isn't currently looking at the app. Push failures never
// affect the Notification row itself or the caller's own request.

interface CreateNotificationParams {
  recipientPersonId?: string;
  recipientUserId?: string;
  type:
    | 'FOLLOW_UP_ASSIGNED'
    | 'PRIVATE_MESSAGE_RECEIVED'
    | 'RESOURCE_GRANTED'
    | 'ROLE_ASSIGNED'
    | 'REPRESENTATION_REQUEST_APPROVED'
    | 'REPRESENTATION_REQUEST_DECLINED'
    | 'PRAYER_REQUEST_COMMENT'
    | 'PRAYER_REQUEST_SUBMITTED_PRIVATELY'
    | 'ANNOUNCEMENT_PUBLISHED'
    | 'HEADQUARTERS_POST_PUBLISHED'
    | 'AREA_LEADERSHIP_ASSIGNED'
    | 'AREA_REPRESENTATION_REQUEST_DECLINED';
  metadata?: Record<string, unknown>;
  targetType?: string;
  targetId?: string;
  push?: PushPayload;
}

async function createNotification(params: CreateNotificationParams) {
  const created = await prisma.notification.create({
    data: {
      recipientPersonId: params.recipientPersonId ?? null,
      recipientUserId: params.recipientUserId ?? null,
      type: params.type,
      metadata: (params.metadata ?? undefined) as any,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
    },
  });
  if (params.push) {
    const push = params.recipientPersonId
      ? pushToPerson(params.recipientPersonId, params.push)
      : params.recipientUserId
        ? pushToUser(params.recipientUserId, params.push)
        : null;
    push?.catch(() => {});
  }
  return created;
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
    push: { title: 'New follow-up assigned', body: `You've been assigned to follow up with ${followedPerson?.name ?? 'someone'}.`, url: '/leader/dashboard' },
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
    push: { title: 'New leadership role', body: `You've been made a Leader of ${community?.name ?? 'a Community'}.`, url: '/member/me' },
  });
}

/** Event 5 — a Member's own Representation Request (see model comment in
 * schema.prisma) has been approved or declined by Admin. */
export async function notifyRepresentationRequestDecided(request: { id: string; personId: string; label: string; status: 'PENDING' | 'APPROVED' | 'DECLINED' }) {
  const approved = request.status === 'APPROVED';
  await createNotification({
    recipientPersonId: request.personId,
    type: approved ? 'REPRESENTATION_REQUEST_APPROVED' : 'REPRESENTATION_REQUEST_DECLINED',
    metadata: { label: request.label },
    targetType: 'RepresentationRequest',
    targetId: request.id,
    push: {
      title: approved ? 'Representation request approved' : 'Representation request declined',
      body: approved ? `Your request to represent "${request.label}" was approved.` : `Your request to represent "${request.label}" was declined.`,
      url: '/member/leadership',
    },
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
    push: { title: 'New resource unlocked', body: resource?.titleEn ? `You now have access to "${resource.titleEn}".` : 'You have a new resource available.', url: '/member/learn' },
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
    push: {
      title: senderName || 'New message',
      body: 'Sent you a message.',
      // Only the Member side has a known, single chat route for this
      // conversation id today — a Leader/Admin recipient opens their own
      // private-messages surface instead, so no deep link is included.
      url: recipientPersonId === conversation.memberPersonId ? `/member/chats/private/${conversation.id}` : undefined,
    },
  });
}

/** Phase 2 — the author of a prayer request receives a new comment on it
 * (never fired for the author commenting on their own request). */
export async function notifyPrayerRequestComment(request: { id: string; authorPersonId: string }, commenterPersonId: string) {
  if (commenterPersonId === request.authorPersonId) return;
  const commenter = await prisma.person.findUnique({ where: { id: commenterPersonId }, select: { name: true } });
  await createNotification({
    recipientPersonId: request.authorPersonId,
    type: 'PRAYER_REQUEST_COMMENT',
    metadata: { commenterName: commenter?.name ?? '' },
    targetType: 'PrayerRequest',
    targetId: request.id,
    push: { title: 'New comment on your prayer request', body: `${commenter?.name ?? 'Someone'} commented on your prayer request.`, url: '/member/prayer' },
  });
}

/** Phase 2 — every ACTIVE Leader of a PRIVATE prayer request's Community is
 * notified of the new submission (its one fan-out recipient list, unlike
 * every other notification helper above). Never fires for PUBLIC requests —
 * there is no designated "leadership" to route those to. */
export async function notifyPrayerRequestSubmittedPrivately(
  request: { id: string; authorPersonId: string },
  leaderPersonIds: string[],
) {
  if (leaderPersonIds.length === 0) return;
  const author = await prisma.person.findUnique({ where: { id: request.authorPersonId }, select: { name: true } });
  await Promise.all(
    leaderPersonIds.map((recipientPersonId) =>
      createNotification({
        recipientPersonId,
        type: 'PRAYER_REQUEST_SUBMITTED_PRIVATELY',
        metadata: { authorName: author?.name ?? '' },
        targetType: 'PrayerRequest',
        targetId: request.id,
        push: { title: 'New private prayer request', body: `${author?.name ?? 'A member'} submitted a private prayer request.`, url: '/member/prayer' },
      }),
    ),
  );
}

/** Phase 5 — a published Announcement or HeadquartersPost, fanned out to
 * every Person currently matching its own audience rule (computed by the
 * caller — see lib/announcements.ts / lib/headquartersPosts.ts). Uses
 * `createMany` rather than one `createNotification` per recipient: these
 * audiences can be an entire Community (or the whole network for a
 * HeadquartersPost's networkWide), so this is the one place in this module
 * where per-row overhead actually matters. The push fan-out is still one
 * call per recipient (each may have multiple devices), but happens after
 * the Notification rows are safely committed. */
async function notifyBroadcastPublished(
  type: 'ANNOUNCEMENT_PUBLISHED' | 'HEADQUARTERS_POST_PUBLISHED',
  target: { targetType: string; targetId: string },
  metadata: Record<string, unknown>,
  recipientPersonIds: string[],
  push: PushPayload,
) {
  if (recipientPersonIds.length === 0) return;
  await prisma.notification.createMany({
    data: recipientPersonIds.map((recipientPersonId) => ({
      recipientPersonId,
      type,
      metadata: metadata as any,
      targetType: target.targetType,
      targetId: target.targetId,
    })),
  });
  pushToPersons(recipientPersonIds, push).catch(() => {});
}

/** Event — every Person currently eligible to see a newly published
 * Announcement (see lib/announcements.ts's own audience resolution, which
 * the caller must have already used to build recipientPersonIds). */
export async function notifyAnnouncementPublished(
  announcement: { id: string; titleEn: string; titleFr: string | null },
  recipientPersonIds: string[],
) {
  await notifyBroadcastPublished(
    'ANNOUNCEMENT_PUBLISHED',
    { targetType: 'Announcement', targetId: announcement.id },
    { titleEn: announcement.titleEn, titleFr: announcement.titleFr ?? announcement.titleEn },
    recipientPersonIds,
    { title: 'New announcement', body: announcement.titleEn, url: '/member/chats' },
  );
}

/** Event — every Person currently eligible to see a newly published
 * HeadquartersPost (see lib/headquartersPosts.ts's own audience
 * resolution, which the caller must have already used to build
 * recipientPersonIds). */
export async function notifyHeadquartersPostPublished(
  post: { id: string; titleEn: string; titleFr: string | null },
  recipientPersonIds: string[],
) {
  await notifyBroadcastPublished(
    'HEADQUARTERS_POST_PUBLISHED',
    { targetType: 'HeadquartersPost', targetId: post.id },
    { titleEn: post.titleEn, titleFr: post.titleFr ?? post.titleEn },
    recipientPersonIds,
    { title: 'New Headquarters post', body: post.titleEn, url: '/member/updates' },
  );
}

/** Phase 6 — a Person has been made the Leader of a GeographicArea (either
 * directly by Admin, or because Admin approved their own
 * AreaRepresentationRequest — either path creates exactly one
 * AreaLeadershipAssignment, so this is the one place that fires). */
export async function notifyAreaLeadershipAssigned(assignment: { id: string; personId: string; areaTitle: string; areaPath: string }) {
  await createNotification({
    recipientPersonId: assignment.personId,
    type: 'AREA_LEADERSHIP_ASSIGNED',
    metadata: { areaTitle: assignment.areaTitle, areaPath: assignment.areaPath },
    targetType: 'AreaLeadershipAssignment',
    targetId: assignment.id,
    push: { title: 'New leadership role', body: `You are now the ${assignment.areaTitle} for ${assignment.areaPath}.`, url: '/member/leadership' },
  });
}

/** Phase 6 — a Member's own AreaRepresentationRequest has been declined.
 * (Approval never fires this — see notifyAreaLeadershipAssigned above,
 * which covers the approved case via the assignment it creates.) */
export async function notifyAreaRepresentationRequestDeclined(request: { id: string; personId: string; areaPath: string }) {
  await createNotification({
    recipientPersonId: request.personId,
    type: 'AREA_REPRESENTATION_REQUEST_DECLINED',
    metadata: { areaPath: request.areaPath },
    targetType: 'AreaRepresentationRequest',
    targetId: request.id,
    push: { title: 'Representation request declined', body: `Your request to represent ${request.areaPath} was declined.`, url: '/member/leadership' },
  });
}
