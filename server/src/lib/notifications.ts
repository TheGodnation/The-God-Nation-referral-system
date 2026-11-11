import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
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
    | 'PRAYER_REQUEST_COMMENT'
    | 'PRAYER_REQUEST_SUBMITTED_PRIVATELY'
    | 'ANNOUNCEMENT_PUBLISHED'
    | 'HEADQUARTERS_POST_PUBLISHED'
    | 'AREA_LEADERSHIP_ASSIGNED'
    | 'AREA_REPRESENTATION_REQUEST_DECLINED'
    | 'LEADER_DASHBOARD_MOVED'
    | 'EXAM_RETAKE_GRANTED'
    | 'EXAM_RETAKE_DECLINED'
    | 'BOOK_PAYMENT_CONFIRMED'
    | 'BOOK_PAYMENT_REJECTED'
    | 'TRAINING_GRACE_GRANTED'
    | 'READ_REQUESTED'
    | 'READ_APPROVED'
    | 'TRAINING_GRACE_DECLINED'
    | 'REFERRAL_EARNING'
    | 'REFERRAL_PAYOUT_PAID'
    | 'REFERRAL_PAYOUT_REJECTED'
    | 'PAYMENT_ORDER_NEW'
    | 'BOOK_PASSED_PAY'
    | 'EVENT_NEW'
    | 'EVENT_REMINDER'
    | 'PAYMENT_ORDER_MESSAGE'
    | 'MEMBER_REPORT_REVIEWED'
    | 'POST_PUBLISHED'
    | 'POST_LIKED'
    | 'POST_REPLIED'
    | 'ASSEMBLY_OPENED'
    | 'ADDED_TO_ASSEMBLY'
    | 'SANCTION_PLACED'
    | 'SANCTION_LIFTED'
    | 'SANCTION_ENDED'
    | 'EXCUSE_REQUESTED'
    | 'REMOVAL_REQUESTED'
    | 'REMOVAL_DECIDED'
    | 'REMOVED_FROM_ASSEMBLY'
    | 'REPRESENTATIVE_APPOINTED'
    | 'REPRESENTATIVE_ENDED'
    | 'REPORT_REMINDER'
    | 'REPORT_LATE'
    | 'ESCALATION_RECEIVED'
    | 'ESCALATION_ANSWERED'
    | 'ESCALATION_BYPASSED'
    | 'CLINIC_EXAM_OPEN'
    | 'GIFT_CONFIRMED'
    | 'GIFT_REJECTED'
    | 'FAITH_NEEDS_CONVERSATION'
    | 'LEADERS_NOT_FOLLOWING_UP';
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

/** Many people were given to a leader at once: one message, not one per person. */
export async function notifyFollowUpBatch(leaderPersonId: string, count: number) {
  await createNotification({
    recipientPersonId: leaderPersonId,
    type: 'FOLLOW_UP_ASSIGNED',
    metadata: { count },
    targetType: 'FollowUpBatch',
    push: { title: 'New people to follow up', body: `${count} people were assigned to you to follow up.`, url: '/member/leadership-dashboard?section=people' },
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

/** The central admin granted (or declined) a retake of a leadership book's exam. */
export async function notifyExamRetakeDecision(request: { id: string; personId: string; assessmentId: string }, granted: boolean) {
  const exam = await prisma.assessment.findUnique({
    where: { id: request.assessmentId },
    select: { trainingBook: { select: { trainingOrder: true, titleEn: true, titleFr: true } } },
  });
  const book = exam?.trainingBook;
  await createNotification({
    recipientPersonId: request.personId,
    type: granted ? 'EXAM_RETAKE_GRANTED' : 'EXAM_RETAKE_DECLINED',
    metadata: { bookNumber: book?.trainingOrder ?? null, bookTitleEn: book?.titleEn ?? '', bookTitleFr: book?.titleFr ?? book?.titleEn ?? '' },
    targetType: 'Assessment',
    targetId: request.assessmentId,
    push: granted
      ? { title: 'Retake granted', body: `You can now retake the exam for Book ${book?.trainingOrder ?? ''}, with new questions.`, url: `/member/assessments/${request.assessmentId}` }
      : { title: 'Retake request', body: `Your retake request for Book ${book?.trainingOrder ?? ''} was not granted for now.`, url: '/member/learn' },
  });
}

/** A leadership book payment was confirmed (manually by the admin, or by the payment company) or rejected. */
export async function notifyBookPaymentDecision(payment: { id: string; personId: string | null; bookNumber: number | null; amount: number }, confirmed: boolean, count = 1) {
  if (!payment.personId) return;
  await createNotification({
    recipientPersonId: payment.personId,
    type: confirmed ? 'BOOK_PAYMENT_CONFIRMED' : 'BOOK_PAYMENT_REJECTED',
    metadata: { bookNumber: payment.bookNumber, amount: payment.amount, count },
    targetType: 'BookPayment',
    targetId: payment.id,
    push: confirmed
      ? { title: 'Payment confirmed', body: count > 1 ? `Your payment for ${count} books is confirmed. Thank you!` : `Your payment for Book ${payment.bookNumber ?? ''} is confirmed. Thank you!`, url: '/member/learn' }
      : { title: 'Payment not confirmed', body: count > 1 ? 'Your payment for several books could not be confirmed. Please check the transaction ID.' : `Your payment for Book ${payment.bookNumber ?? ''} could not be confirmed. Please check the transaction ID.`, url: '/member/learn' },
  });
}

/** Someone you invited paid for a book: you earned your share. */
export async function notifyReferralEarning(earning: { id: string; referrerPersonId: string; amount: number; bookNumber: number | null }) {
  await createNotification({
    recipientPersonId: earning.referrerPersonId,
    type: 'REFERRAL_EARNING',
    metadata: { amount: earning.amount, bookNumber: earning.bookNumber },
    targetType: 'ReferralEarning',
    targetId: earning.id,
    push: { title: 'You earned ' + earning.amount + ' FCFA', body: 'Someone you invited paid for a leadership book.', url: '/member/earnings' },
  });
}

/** Your payout request was paid, or could not be paid. */
export async function notifyReferralPayout(payout: { id: string; personId: string; amount: number }, paid: boolean) {
  await createNotification({
    recipientPersonId: payout.personId,
    type: paid ? 'REFERRAL_PAYOUT_PAID' : 'REFERRAL_PAYOUT_REJECTED',
    metadata: { amount: payout.amount },
    targetType: 'ReferralPayout',
    targetId: payout.id,
    push: paid
      ? { title: 'Payout sent', body: payout.amount + ' FCFA has been sent to your Mobile Money number.', url: '/member/earnings' }
      : { title: 'Payout not sent', body: 'We could not send your payout request. Your earnings are back in your balance.', url: '/member/earnings' },
  });
}

/** A member asked to start reading (the Play Store app has no prices): tell the central admin to approve it. */
export async function notifyReadRequested(person: { id: string; name: string }) {
  await notifyCentralAdmins(
    'READ_REQUESTED',
    { targetType: 'Person', targetId: person.id },
    { personName: person.name },
    { title: 'Request to read', body: `${person.name} asked to start reading. Approve it in the Library tab.`, url: '/member/me' },
  );
}

/** The central admin approved a member's request to read: they can start. */
export async function notifyReadApproved(personId: string) {
  await createNotification({
    recipientPersonId: personId,
    type: 'READ_APPROVED',
    metadata: {},
    targetType: 'Person',
    targetId: personId,
    push: { title: 'You can start reading', body: 'Your request was approved. Open the Leadership School to begin.', url: '/member/school' },
  });
}

/** The central admin granted (or declined) "study now, pay later" grace. */
export async function notifyTrainingGraceDecision(request: { id: string; personId: string; grantedBooks: number | null }, granted: boolean) {
  await createNotification({
    recipientPersonId: request.personId,
    type: granted ? 'TRAINING_GRACE_GRANTED' : 'TRAINING_GRACE_DECLINED',
    metadata: { books: request.grantedBooks },
    targetType: 'TrainingGraceRequest',
    targetId: request.id,
    push: granted
      ? { title: 'Grace granted', body: `You may now study up to ${request.grantedBooks ?? ''} books before paying.`, url: '/member/learn' }
      : { title: 'Grace request', body: 'Your request to study now and pay later was not granted for now.', url: '/member/learn' },
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

/** The central admin is told that leaders have not been following up (at most once a day, see lib/leaderAlertLoop.ts). */
export async function notifyLeadersNotFollowingUp(adminPersonId: string, count: number) {
  await createNotification({
    recipientPersonId: adminPersonId,
    type: 'LEADERS_NOT_FOLLOWING_UP',
    metadata: { count },
    push: {
      title: '⚠️ Leaders not following up',
      body: count === 1 ? '1 leader has not contacted anyone for a week.' : `${count} leaders have not contacted anyone for a week.`,
      url: '/member/me',
      tag: 'leader-alerts',
      urgent: true,
    },
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
  let senderBadge: 'NATIONAL_COORDINATOR' | null = null;

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
      // The National Coordinator's messages say so.
      if (await isCentralAdminPerson(sender.personId)) senderBadge = 'NATIONAL_COORDINATOR';
    } else {
      senderName = null; // Central Authority — client shows its own generic label.
    }
  }

  await createNotification({
    recipientPersonId,
    recipientUserId,
    type: 'PRIVATE_MESSAGE_RECEIVED',
    metadata: { senderName, ...(senderBadge ? { senderBadge } : {}) },
    targetType: 'PrivateConversation',
    targetId: conversation.id,
    push: {
      title: senderBadge ? `${senderName} · National Coordinator` : senderName || 'New message',
      body: 'Sent you a message.',
      // Only the Member side has a known, single chat route for this
      // conversation id today — a Leader/Admin recipient opens their own
      // private-messages surface instead, so no deep link is included.
      url: recipientPersonId === conversation.memberPersonId ? `/member/chats/private/${conversation.id}` : undefined,
      tag: `private-${conversation.id}`,
      urgent: true,
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

/** Unified Leader/Member identity — fires exactly once, the moment a Person
 * is newly linked to an active Leader User, whether by the Leader's own
 * self-serve bridge (leader.ts's /me/create-member-profile) or Admin's
 * "Assign as Leader" action (admin.ts's /leaders/assign). Deliberately NEVER
 * for role=ADMIN — Admin bridging to a Member profile is a separate,
 * unrelated action with no Leadership Dashboard to announce. Idempotent via
 * User.personLinkNotifiedAt, so it is safe to call from every linking call
 * site without each one separately tracking whether it already fired. */
export async function notifyLeaderDashboardMovedIfNeeded(user: {
  id: string;
  role: string;
  personId: string | null;
  personLinkNotifiedAt: Date | null;
}) {
  if (user.role !== 'LEADER' || !user.personId || user.personLinkNotifiedAt) return;
  await prisma.user.update({ where: { id: user.id }, data: { personLinkNotifiedAt: new Date() } });
  await createNotification({
    recipientPersonId: user.personId,
    type: 'LEADER_DASHBOARD_MOVED',
    targetType: 'User',
    targetId: user.id,
    push: {
      title: 'Your Leadership Dashboard moved',
      body: 'Your Leadership tools now live right inside this app — look for My Leadership Dashboard.',
      url: '/member/leadership-dashboard',
    },
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

/** A member opened a payment order with this payment agent. */
export async function notifyPaymentOrderNew(order: { id: string; bookNumber: number | null }, agentPersonId: string, buyerName: string, count = 1) {
  await createNotification({
    recipientPersonId: agentPersonId,
    type: 'PAYMENT_ORDER_NEW',
    metadata: { name: buyerName, bookNumber: order.bookNumber, count },
    targetType: 'PaymentOrder',
    targetId: order.id,
    push: { title: 'New payment order', body: count > 1 ? `${buyerName} wants to pay for ${count} books.` : `${buyerName} wants to pay for Book ${order.bookNumber ?? ''}.`, url: `/member/payment-orders/${order.id}` },
  });
}

/** A new message (or payment claim) in a payment order, for the other side. */
export async function notifyPaymentOrderMessage(order: { id: string }, recipientPersonId: string, senderName: string) {
  await createNotification({
    recipientPersonId,
    type: 'PAYMENT_ORDER_MESSAGE',
    metadata: { name: senderName },
    targetType: 'PaymentOrder',
    targetId: order.id,
    push: { title: senderName, body: 'New message about a book payment.', url: `/member/payment-orders/${order.id}` },
  });
}

/** Nobody has answered the member for a few minutes: one more nudge for the representative. */
export async function notifyPaymentOrderReminder(order: { id: string }, agentPersonId: string, buyerName: string) {
  await createNotification({
    recipientPersonId: agentPersonId,
    type: 'PAYMENT_ORDER_MESSAGE',
    metadata: { name: buyerName, reminder: true },
    targetType: 'PaymentOrder',
    targetId: order.id,
    push: { title: `${buyerName} is waiting`, body: 'A member is still waiting for your reply about a book payment.', url: `/member/payment-orders/${order.id}` },
  });
}

/** The member passed a book and still has books to pay for: a nudge to pay (several at once if they like). */
export async function notifyBookPassedPay(personId: string, passedNumber: number) {
  await createNotification({
    recipientPersonId: personId,
    type: 'BOOK_PASSED_PAY',
    metadata: { bookNumber: passedNumber },
    targetType: 'LibraryBook',
    push: {
      title: `You passed Book ${passedNumber}!`,
      body: 'Your next book is waiting for payment. You can pay for 2, 3 or more books at once.',
      url: '/member/school',
    },
  });
}

/** A leader (or the central admin) added an event to an assembly's calendar. */
export async function notifyEventNew(event: { id: string; title: string; startsAt: Date; communityName: string }, recipientPersonIds: string[]) {
  if (recipientPersonIds.length === 0) return;
  await prisma.notification.createMany({
    data: recipientPersonIds.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'EVENT_NEW' as const,
      metadata: { title: event.title, community: event.communityName, startsAt: event.startsAt.toISOString() } as any,
      targetType: 'AssemblyEvent',
      targetId: event.id,
    })),
  });
  pushToPersons(recipientPersonIds, { title: `📅 ${event.title}`, body: `New event in ${event.communityName}.`, url: `/member/events/${event.id}` }).catch(() => {});
}

/** The event starts within the hour. */
export async function notifyEventSoon(event: { id: string; title: string; startsAt: Date; communityName: string }, recipientPersonIds: string[]) {
  if (recipientPersonIds.length === 0) return;
  await prisma.notification.createMany({
    data: recipientPersonIds.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'EVENT_REMINDER' as const,
      metadata: { title: event.title, community: event.communityName, startsAt: event.startsAt.toISOString() } as any,
      targetType: 'AssemblyEvent',
      targetId: event.id,
    })),
  });
  pushToPersons(recipientPersonIds, { title: `⏰ ${event.title}`, body: 'Starts in about an hour.', url: `/member/events/${event.id}` }).catch(() => {});
}

/** Tells the person who reported something what the reviewer found (and any note). */
export async function notifyMemberReportReviewed(
  report: { id: string; reporterPersonId: string; targetType: string },
  outcome: 'VIOLATION' | 'NO_VIOLATION' | null,
  note: string | null,
) {
  const person = await prisma.person.findUnique({ where: { id: report.reporterPersonId }, select: { preferredLanguage: true } });
  const fr = person?.preferredLanguage === 'fr';
  const body =
    outcome === 'VIOLATION'
      ? fr
        ? 'Merci pour votre signalement. Nous l\'avons examiné : cela ne respectait pas les normes chrétiennes. Une mesure a été prise.'
        : 'Thank you for your report. We looked at it, and it did not follow Christian standards. Action was taken.'
      : outcome === 'NO_VIOLATION'
        ? fr
          ? 'Merci pour votre signalement. Nous l\'avons examiné et n\'avons pas constaté d\'infraction aux normes chrétiennes.'
          : 'Thank you for your report. We looked at it and did not find that it breaks Christian standards.'
        : fr
          ? 'Merci pour votre signalement. Il a été examiné.'
          : 'Thank you for your report. It has been looked at.';
  await createNotification({
    recipientPersonId: report.reporterPersonId,
    type: 'MEMBER_REPORT_REVIEWED',
    metadata: { outcome, note: note ?? '', reportTargetType: report.targetType },
    targetType: 'MemberReport',
    targetId: report.id,
    push: { title: fr ? 'À propos de votre signalement' : 'About your report', body: note ? `${body} ${note}` : body, url: '/member/me' },
  });
}

/** A polite word to the person whose post / comment was reported and found to
 * go against the community's standards: everything shared here must keep to
 * the teachings of the Kingdom of God and of Christ. Never names who reported.
 * Sent once per reported item, however many people reported it. */
export async function notifyReportedAuthor(
  report: { id: string; reportedPersonId: string; targetType: string; targetId: string | null },
  removed: boolean,
) {
  if (report.targetId) {
    const already = await prisma.notification.findFirst({
      where: { recipientPersonId: report.reportedPersonId, type: 'MEMBER_REPORT_REVIEWED', targetType: report.targetType, targetId: report.targetId },
      select: { id: true },
    });
    if (already) return;
  }
  const person = await prisma.person.findUnique({ where: { id: report.reportedPersonId }, select: { preferredLanguage: true } });
  const fr = person?.preferredLanguage === 'fr';
  const body = fr
    ? `Quelque chose que vous avez partagé a été signalé et examiné par les responsables. Dans cette communauté, tout ce qui est publié doit rester conforme à l'enseignement du Royaume de Dieu et à l'enseignement de Christ.${removed ? ' Cette publication a été retirée.' : ''} Merci de partager seulement ce qui édifie le corps de Christ. Que Dieu vous bénisse.`
    : `Something you shared was reported and reviewed by the leaders. In this community, everything shared must keep to the teachings of the Kingdom of God and the teachings of Christ.${removed ? ' It has been removed.' : ''} Please share only what builds up the body of Christ. God bless you.`;
  await createNotification({
    recipientPersonId: report.reportedPersonId,
    type: 'MEMBER_REPORT_REVIEWED',
    metadata: { audience: 'REPORTED', removed, reportTargetType: report.targetType },
    // The reported item, so the same author is not told twice about it.
    targetType: report.targetType,
    targetId: report.targetId ?? undefined,
    push: { title: fr ? 'Un mot des responsables' : 'A word from the leaders', body, url: '/member/me' },
  });
}

// ---------------------------------------------------------------------------
// Posts, likes and replies.

const snippet = (text: string | null | undefined, max = 90) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** A new Updates post by the central admin: the whole community is told. (Anyone else's post notifies nobody.)
 * The caller works out the recipients. */
export async function notifyPostPublished(post: { id: string; body: string }, author: { id: string; name: string }, recipientPersonIds: string[]) {
  const recipients = recipientPersonIds.filter((id) => id !== author.id);
  if (recipients.length === 0) return;
  await prisma.notification.createMany({
    data: recipients.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'POST_PUBLISHED' as const,
      metadata: { authorName: author.name } as any,
      targetType: 'UpdatePost',
      targetId: post.id,
    })),
  });
  pushToPersons(recipients, {
    title: `${author.name} • The God Nation`,
    body: snippet(post.body) || '📷 New post',
    url: '/member/updates',
  }).catch(() => {});
}

// The same person reacting to the same thing again within a day is told once, so toggling a
// like on and off never fills someone's bell.
async function alreadyToldRecently(recipientPersonId: string, type: 'POST_LIKED', targetId: string, actorPersonId: string) {
  const found = await prisma.notification.findFirst({
    where: {
      recipientPersonId,
      type,
      targetId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      metadata: { path: ['actorPersonId'], equals: actorPersonId },
    },
    select: { id: true },
  });
  return Boolean(found);
}

/** Someone reacted to your post, comment or chat message. `kind` says which. Never to yourself. */
export async function notifyPostLiked(args: {
  recipientPersonId: string;
  actor: { id: string; name: string };
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  targetType: string;
  targetId: string;
  url: string;
  emoji?: string;
}) {
  if (args.recipientPersonId === args.actor.id) return;
  if (await alreadyToldRecently(args.recipientPersonId, 'POST_LIKED', args.targetId, args.actor.id)) return;
  await createNotification({
    recipientPersonId: args.recipientPersonId,
    type: 'POST_LIKED',
    metadata: { actorPersonId: args.actor.id, actorName: args.actor.name, kind: args.kind, emoji: args.emoji ?? null },
    targetType: args.targetType,
    targetId: args.targetId,
    push: {
      title: args.actor.name,
      body: `${args.emoji ?? '👍'} ${args.kind === 'POST' ? 'reacted to your post' : args.kind === 'COMMENT' ? 'reacted to your comment' : 'reacted to your message'}`,
      url: args.url,
    },
  });
}

/** Someone commented on your post, replied to your comment, or replied to your chat message. Never to yourself. */
export async function notifyPostReplied(args: {
  recipientPersonId: string;
  actor: { id: string; name: string };
  kind: 'POST_COMMENT' | 'COMMENT_REPLY' | 'MESSAGE_REPLY';
  targetType: string;
  targetId: string;
  url: string;
  text?: string | null;
}) {
  if (args.recipientPersonId === args.actor.id) return;
  await createNotification({
    recipientPersonId: args.recipientPersonId,
    type: 'POST_REPLIED',
    metadata: { actorPersonId: args.actor.id, actorName: args.actor.name, kind: args.kind },
    targetType: args.targetType,
    targetId: args.targetId,
    push: {
      title: args.actor.name,
      body: `${args.kind === 'POST_COMMENT' ? 'commented on your post' : args.kind === 'COMMENT_REPLY' ? 'replied to your comment' : 'replied to your message'}${snippet(args.text) ? `: ${snippet(args.text)}` : ''}`,
      url: args.url,
    },
  });
}

/** The app opened a new assembly because the previous one was full: tell
 * the central admin (their member profile, or their admin account when it
 * has no member profile yet) so leaders can be appointed to it. */
export async function notifyAssemblyOpened(assembly: { id: string; name: string; parentName: string }) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true, personId: true } });
  await Promise.all(
    admins.map((a) =>
      createNotification({
        ...(a.personId ? { recipientPersonId: a.personId } : { recipientUserId: a.id }),
        type: 'ASSEMBLY_OPENED',
        metadata: { assemblyName: assembly.name, parentName: assembly.parentName },
        targetType: 'Community',
        targetId: assembly.id,
        push: { title: 'A new assembly has opened', body: `${assembly.parentName} was full, so ${assembly.name} has opened. Appoint its leaders.`, url: '/member/me' },
      }),
    ),
  );
}

/** The central admin added many people to an assembly: one short notice each, with a single push. */
export async function notifyAddedToAssembly(personIds: string[], assembly: { id: string; name: string }) {
  if (personIds.length === 0) return;
  await prisma.notification.createMany({
    data: personIds.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'ADDED_TO_ASSEMBLY' as const,
      metadata: { assemblyName: assembly.name } as any,
      targetType: 'Community',
      targetId: assembly.id,
    })),
  });
  pushToPersons(personIds, { title: '🙏 ' + assembly.name, body: `You were added to ${assembly.name}.`, url: `/member/chats/group/${assembly.id}` }).catch(() => {});
}

// ---- Sanctions (mutes and removal requests) -------------------------------------------------------

/** You were muted in an assembly (the reason and the end date are shown inside the assembly). */
export async function notifySanctionPlaced(personId: string, s: { id: string; assemblyName: string; endsAt: Date; reason: string }) {
  await createNotification({
    recipientPersonId: personId,
    type: 'SANCTION_PLACED',
    metadata: { assemblyName: s.assemblyName, endsAt: s.endsAt.toISOString(), reason: s.reason },
    targetType: 'MemberSanction',
    targetId: s.id,
    push: { title: `🔇 ${s.assemblyName}`, body: `You are muted until ${s.endsAt.toISOString().slice(0, 10)}. Reason: ${s.reason}`, url: '/member/chats' },
  });
}

/** A mute was lifted early. */
export async function notifySanctionLifted(personId: string, s: { id: string; assemblyName: string }) {
  await createNotification({
    recipientPersonId: personId,
    type: 'SANCTION_LIFTED',
    metadata: { assemblyName: s.assemblyName },
    targetType: 'MemberSanction',
    targetId: s.id,
    push: { title: `✅ ${s.assemblyName}`, body: 'Your mute was lifted. You can write again.', url: '/member/chats' },
  });
}

/** A mute ended by itself. */
export async function notifySanctionEnded(personId: string, s: { id: string; assemblyName: string }) {
  await createNotification({
    recipientPersonId: personId,
    type: 'SANCTION_ENDED',
    metadata: { assemblyName: s.assemblyName },
    targetType: 'MemberSanction',
    targetId: s.id,
    push: { title: `✅ ${s.assemblyName}`, body: 'Your mute has ended. You can write again.', url: '/member/chats' },
  });
}

/** A muted person asked for excuse: goes to whoever muted them. */
export async function notifyExcuseRequested(recipientPersonId: string, s: { id: string; personName: string; assemblyName: string }) {
  await createNotification({
    recipientPersonId,
    type: 'EXCUSE_REQUESTED',
    metadata: { personName: s.personName, assemblyName: s.assemblyName },
    targetType: 'MemberSanction',
    targetId: s.id,
    push: { title: `🙏 ${s.personName}`, body: `Asks for excuse (${s.assemblyName}).`, url: '/member/leadership-dashboard' },
  });
}

/** A leader asks the central admin to remove someone from an assembly. */
export async function notifyRemovalRequested(r: { id: string; personName: string; assemblyName: string; requesterName: string }) {
  await notifyCentralAdmins('REMOVAL_REQUESTED', { targetType: 'RemovalRequest', targetId: r.id }, { personName: r.personName, assemblyName: r.assemblyName, requesterName: r.requesterName }, {
    title: '⚠️ Removal request',
    body: `${r.requesterName} asks to remove ${r.personName} from ${r.assemblyName}.`,
    url: '/member/me',
  });
}

/** The central admin's decision, sent to whoever asked. */
export async function notifyRemovalDecided(recipientPersonId: string, r: { id: string; personName: string; assemblyName: string; approved: boolean; note: string | null }) {
  await createNotification({
    recipientPersonId,
    type: 'REMOVAL_DECIDED',
    metadata: { personName: r.personName, assemblyName: r.assemblyName, approved: r.approved, note: r.note },
    targetType: 'RemovalRequest',
    targetId: r.id,
    push: { title: r.approved ? '✅ Removal approved' : 'Removal declined', body: `${r.personName} — ${r.assemblyName}`, url: '/member/leadership-dashboard' },
  });
}

/** You were removed from an assembly by the central admin. */
export async function notifyRemovedFromAssembly(personId: string, s: { id: string; assemblyName: string }) {
  await createNotification({
    recipientPersonId: personId,
    type: 'REMOVED_FROM_ASSEMBLY',
    metadata: { assemblyName: s.assemblyName },
    targetType: 'Community',
    targetId: s.id,
    push: { title: s.assemblyName, body: `You were removed from ${s.assemblyName}.`, url: '/member/chats' },
  });
}

/** The central admin appointed you representative of a generation. */
export async function notifyRepresentativeAppointed(personId: string, generation: number) {
  await createNotification({
    recipientPersonId: personId,
    type: 'REPRESENTATIVE_APPOINTED',
    metadata: { generation },
    targetType: 'GenerationRepresentative',
    push: { title: '🧭 Representative', body: `You are now the representative of generation ${generation}.`, url: '/member/leadership-dashboard' },
  });
}

/** Your time as representative of a generation ended. */
export async function notifyRepresentativeEnded(personId: string, generation: number) {
  await createNotification({
    recipientPersonId: personId,
    type: 'REPRESENTATIVE_ENDED',
    metadata: { generation },
    targetType: 'GenerationRepresentative',
    push: { title: '🧭 Representative', body: `You are no longer the representative of generation ${generation}.`, url: '/member/leadership-dashboard' },
  });
}

/** The weekly report is still to be sent (Sunday evening / a manual reminder) or is late. */
export async function notifyWeeklyReport(personId: string, kind: 'REPORT_REMINDER' | 'REPORT_LATE', weekStart: Date) {
  const day = weekStart.toISOString().slice(0, 10);
  await createNotification({
    recipientPersonId: personId,
    type: kind,
    metadata: { weekStart: day },
    targetType: 'LeaderWeeklyReport',
    push: {
      title: kind === 'REPORT_LATE' ? '⏰ Your weekly report is late' : '📝 Your weekly report',
      body: kind === 'REPORT_LATE' ? 'Please send it today.' : 'It takes a minute: how many people you contacted, who needs help, prayer needs.',
      url: '/member/leadership-dashboard?section=weeklyReport',
    },
  });
}

/** A notification to the central admin: to their member profile, or to their admin account when it has none. */
async function notifyCentralAdmins(
  type: 'ESCALATION_RECEIVED' | 'ESCALATION_ANSWERED' | 'ESCALATION_BYPASSED' | 'READ_REQUESTED' | 'REMOVAL_REQUESTED',
  target: { targetType: string; targetId: string },
  metadata: Record<string, unknown>,
  push: PushPayload,
) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true, personId: true } });
  await Promise.all(
    admins.map((a) =>
      createNotification({
        ...(a.personId ? { recipientPersonId: a.personId } : { recipientUserId: a.id }),
        type,
        metadata,
        targetType: target.targetType,
        targetId: target.targetId,
        push,
      }),
    ),
  );
}

export interface EscalationNoticeInfo {
  id: string;
  askerName: string;
  aboutName: string;
  urgent: boolean;
}

/** A leader's hard question reached you (a parent-assembly leader, or the central admin). `passedOn`: it was passed on to you because the leaders before you did not answer in time or were away. */
export async function notifyEscalationReceived(e: EscalationNoticeInfo, recipientPersonIds: string[] | 'ADMIN', passedOn = false) {
  const metadata = { askerName: e.askerName, aboutName: e.aboutName, urgent: e.urgent, passedOn };
  const push = {
    title: e.urgent ? 'Urgent question from a leader' : 'Question from a leader',
    body: `${e.askerName} asks about ${e.aboutName}.`,
    url: '/member/me',
  };
  if (recipientPersonIds === 'ADMIN') {
    await notifyCentralAdmins('ESCALATION_RECEIVED', { targetType: 'FollowUpEscalation', targetId: e.id }, metadata, push);
    return;
  }
  await Promise.all(
    recipientPersonIds.map((recipientPersonId) =>
      createNotification({ recipientPersonId, type: 'ESCALATION_RECEIVED', metadata, targetType: 'FollowUpEscalation', targetId: e.id, push }),
    ),
  );
}

/** Your question was answered. */
export async function notifyEscalationAnswered(e: EscalationNoticeInfo, askerPersonId: string, answererName: string) {
  await createNotification({
    recipientPersonId: askerPersonId,
    type: 'ESCALATION_ANSWERED',
    metadata: { aboutName: e.aboutName, answererName },
    targetType: 'FollowUpEscalation',
    targetId: e.id,
    push: { title: 'Your question was answered', body: `${answererName} answered your question about ${e.aboutName}.`, url: '/member/leadership-dashboard' },
  });
}

/** A question was passed on past you (you were away, or did not answer in time), or past the leaders you asked: to the central admin. */
export async function notifyEscalationBypassed(e: EscalationNoticeInfo, recipientPersonIds: string[], role: 'SKIPPED' | 'ASKER', reason: 'AWAY' | 'NO_REPLY') {
  await Promise.all(
    recipientPersonIds.map((recipientPersonId) =>
      createNotification({
        recipientPersonId,
        type: 'ESCALATION_BYPASSED',
        metadata: { askerName: e.askerName, aboutName: e.aboutName, role, reason },
        targetType: 'FollowUpEscalation',
        targetId: e.id,
        push: {
          title: 'A question was passed on',
          body: role === 'ASKER' ? `Your question about ${e.aboutName} was passed on to the central administration.` : `${e.askerName}'s question about ${e.aboutName} was passed on to the central administration.`,
          url: '/member/me',
        },
      }),
    ),
  );
}

/** The central admin confirmed (a thank-you) or could not confirm a gift the member said they made. */
export async function notifyGiftDecision(gift: { id: string; personId: string | null; amount: number }, confirmed: boolean) {
  if (!gift.personId) return;
  await createNotification({
    recipientPersonId: gift.personId,
    type: confirmed ? 'GIFT_CONFIRMED' : 'GIFT_REJECTED',
    metadata: { amount: gift.amount },
    targetType: 'Gift',
    targetId: gift.id,
    push: confirmed
      ? { title: 'Thank you', body: 'Your gift was received. God bless you.', url: '/member/give' }
      : { title: 'Gift not confirmed', body: 'We could not confirm your gift. Please check the transaction ID.', url: '/member/give' },
  });
}

/** A Dominion Clinic exam has opened: everyone who can take it is told once. */
export async function notifyClinicExamOpen(personIds: string[], info: { assessmentId: string; number: number; questions: number }) {
  if (personIds.length === 0) return;
  await prisma.notification.createMany({
    data: personIds.map((recipientPersonId) => ({
      recipientPersonId,
      type: 'CLINIC_EXAM_OPEN' as const,
      metadata: { number: info.number, questions: info.questions } as any,
      targetType: 'Assessment',
      targetId: info.assessmentId,
    })),
  });
  pushToPersons(personIds, { title: 'Dominion Clinic exam', body: `Exam ${info.number} is open: ${info.questions} questions from the book.`, url: '/member/learn' }).catch(() => {});
}

/**
 * Someone finished the Book 1 / Book 2 exam and their personal answers call
 * for a conversation. Goes to the central admin (and, when he has allowed it,
 * the person's leaders), with a link to the person's faith journey.
 */
export async function notifyFaithNeedsConversation(
  recipient: { personId?: string | null; userId?: string | null },
  person: { id: string; name: string },
  bookNumber: number | null,
) {
  if (!recipient.personId && !recipient.userId) return;
  await createNotification({
    recipientPersonId: recipient.personId ?? undefined,
    recipientUserId: recipient.personId ? undefined : (recipient.userId ?? undefined),
    type: 'FAITH_NEEDS_CONVERSATION',
    metadata: { personName: person.name, bookNumber },
    targetType: 'FaithJourney',
    targetId: person.id,
    push: {
      title: 'A conversation is needed',
      body: `${person.name} finished the ${bookNumber ? `Book ${bookNumber}` : 'book'} exam and would be helped by a conversation.`,
      url: `/member/faith/${person.id}`,
    },
  });
}
