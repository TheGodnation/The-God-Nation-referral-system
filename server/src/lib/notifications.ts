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
    | 'TRAINING_GRACE_DECLINED'
    | 'REFERRAL_EARNING'
    | 'REFERRAL_PAYOUT_PAID'
    | 'REFERRAL_PAYOUT_REJECTED'
    | 'PAYMENT_ORDER_NEW'
    | 'BOOK_PASSED_PAY'
    | 'EVENT_NEW'
    | 'EVENT_REMINDER'
    | 'PAYMENT_ORDER_MESSAGE';
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
