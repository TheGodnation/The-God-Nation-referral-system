import rateLimit from 'express-rate-limit';

// IP is used here only as a security/abuse-prevention signal, never as
// visitor identity.

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

export const referralVisitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const registrationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const whatsappRedirectLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Leader account-setup completion (token -> password). Not as tight as
// login since a legitimate Leader may retry a typo'd password.
export const leaderSetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Password-reset request (email enumeration surface) — deliberately tight.
export const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Password-reset redemption (token -> new password).
export const passwordResetRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Admin-triggered sensitive actions: creating/inviting/recovering a Leader.
export const adminSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Leader self-signup (public, gated only by a shared access phrase) —
// tight, since a wrong-phrase guess here is effectively a brute-force
// attempt against the phrase, and a right guess creates a real account.
export const leaderSignupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Public Contact form (Phase 2) — tight, since this is an unauthenticated
// form that sends an email and writes to the database on every success.
export const contactFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please try again later.' },
});

// Member magic-link request (Phase 3C) — a WhatsApp/email enumeration
// surface, same threat model as passwordResetRequestLimiter, so equally tight.
export const memberLoginRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Public member sign-up (email + phone -> sign-in link). Same enumeration
// threat model as memberLoginRequestLimiter, so equally tight.
export const memberSignupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Member finishing their sign-up details form.
export const memberCompleteProfileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Member magic-link consumption (token -> session). Tokens are 32 random
// bytes (infeasible to brute force) but this limiter is still defense in
// depth, matching passwordResetRedeemLimiter's precedent.
export const memberLoginConsumeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Member-initiated assessment actions (starting/submitting an own attempt).
export const memberAssessmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3D: Admin/Leader scoped-leadership + follow-up mutations (linking a
// Leader to a Person, creating/ending RoleAssignments, creating/reassigning/
// closing FollowUpAssignments, logging FollowUpContacts). Authenticated,
// lower enumeration risk than the public limiters above, but still a
// dedicated limiter per the project's "never rely solely on
// generalApiLimiter" convention.
export const leadershipMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3F: a Member updating their own name/preferredLanguage. Low
// enumeration risk (authenticated, own data only), but still a dedicated
// limiter per the project's "never rely solely on generalApiLimiter"
// convention for mutations.
export const memberProfileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3G: Admin Community create/edit (including reparenting). Originally
// shared with Geography's own admin mutations too; Final Geography
// Retirement removed the Geography model and its admin routes entirely, so
// this is Community-only now (renamed from communityGeographyMutationLimiter
// accordingly). Authenticated, Admin-only, lower enumeration risk than the
// public limiters above, but still a dedicated limiter per the project's
// "never rely solely on generalApiLimiter" convention — matching the
// magnitude of leadershipMutationLimiter, the closest existing precedent for
// an Admin-authenticated structural-mutation category.
export const communityMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.1: sending a message to a Community conversation. Authenticated
// (Member or Leader), lower enumeration risk than the public limiters
// above, but still a dedicated limiter per the project's "never rely
// solely on generalApiLimiter" convention — matching leadershipMutationLimiter's
// magnitude, the closest existing precedent for an authenticated,
// non-enumeration-risk mutation.
export const messageSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please slow down.' },
});

// Phase 3M.2: sending a message in a Follow-Up conversation. Same design
// and magnitude as messageSendLimiter, kept as its own dedicated export —
// per the project's per-category-limiter convention — so Community and
// Follow-Up messaging quotas never share or starve one another.
export const followUpMessageSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please slow down.' },
});

// Phase 3M.3: Admin announcement create/edit/publish/archive mutations.
// Authenticated, Admin-only, lower enumeration risk than the public
// limiters above, but still a dedicated limiter per the project's "never
// rely solely on generalApiLimiter" convention — matching the magnitude of
// communityMutationLimiter, the closest existing precedent for an
// Admin-authenticated structural-mutation category.
export const announcementMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.5: a Member/Leader marking one of their own visible announcements
// read. Own-data-only, idempotent, and expected to fire once per
// announcement a Person actually opens — a higher ceiling than
// announcementMutationLimiter (an Admin authoring action) is appropriate,
// but this remains its own dedicated limiter per the project's "never rely
// solely on generalApiLimiter" convention, so a burst of read-marking (e.g.
// opening several announcements in one session) never competes with any
// other mutation category's quota.
export const announcementReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.7: marking a conversation read. Same design and magnitude as
// announcementReadLimiter (own-data-only, idempotent, expected to fire
// once per conversation a Person actually opens) — one dedicated limiter
// per conversation surface, per the project's per-category-limiter
// convention, so Community/Follow-Up read-marking quotas never share or
// starve one another, or the surfaces' own message-send limiters.
export const communityConversationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const followUpConversationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.8A: Community Administrator moderation/administration mutations
// (deleting a message, adding/removing a Community member). Authenticated,
// role-gated, lower enumeration risk than the public limiters above, but
// still its own dedicated limiter per the project's "never rely solely on
// generalApiLimiter" convention — matching leadershipMutationLimiter's
// magnitude, the closest existing precedent for an authenticated,
// non-enumeration-risk structural mutation.
export const communityModerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.8B: Central Authority (Admin) conversation oversight — inspecting
// a Community/Follow-Up conversation's message history. Every
// call is reason-gated and audited (see adminConversationOversight.ts), so
// this limiter exists to bound how much of that sensitive, accountable
// activity can happen in a burst — its own dedicated category per the
// project's "never rely solely on generalApiLimiter" convention, distinct
// from every ordinary participant-facing conversation limiter above (this
// is Admin-only, never a Member/Leader path). Sized a bit higher than
// leadershipMutationLimiter's magnitude to comfortably allow paging through
// a long conversation's history within one legitimate review.
export const centralAuthorityOversightLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.8C: a Member's own "delete for me" action on one of their own
// messages. Low-risk (never affects another Person's view), but still its
// own dedicated limiter per the project's convention — sized like
// communityConversationReadLimiter, since this is a lightweight, frequent,
// idempotent participant action, not a moderation action.
// Reacting to group chat messages (👍 ❤️ …) — cheap and frequent.
// "typing…" signals — the app sends at most one every few seconds while
// someone is typing.
export const typingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const messageReactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const messageHideLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.8C: requesting a presigned upload URL for a Community message
// attachment. Tighter than ordinary read/send limiters — each call causes
// this server to mint a real (if short-lived) credential for writing to the
// R2 bucket, so a burst here is a more meaningful abuse signal than an
// ordinary message send.
export const attachmentUploadAuthorizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 3M.8C: requesting a presigned download URL for an existing
// attachment. Higher than the upload-authorize limiter (opening a
// conversation with several image attachments legitimately fires several of
// these in a row), but still its own dedicated category.
export const attachmentDownloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Phase 2B: sending a message to a generation's Leadership Collaboration
// conversation. Same design and magnitude as messageSendLimiter/
// followUpMessageSendLimiter, kept as its own
// dedicated export per the project's per-category-limiter convention — this
// surface's messaging quota never shares or starves any other surface's.
export const leadershipCollaborationMessageSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please slow down.' },
});

// Phase 2B: marking a Leadership Collaboration conversation read. Same
// design and magnitude as communityConversationReadLimiter/
// followUpConversationReadLimiter.
export const leadershipCollaborationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Headquarters Network Posts: Admin create/edit/publish/archive mutations.
// Authenticated, Admin-only, lower enumeration risk than the public
// limiters above, but still its own dedicated limiter per the project's
// "never rely solely on generalApiLimiter" convention — matching the
// magnitude of announcementMutationLimiter, the closest existing precedent
// for an Admin-authenticated content-authoring category.
export const headquartersPostMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Headquarters Network Posts: a Member/Leader posting a comment on a post.
// Same design and magnitude as messageSendLimiter/followUpMessageSendLimiter
// /leadershipCollaborationMessageSendLimiter,
// kept as its own dedicated export per the project's per-category-limiter
// convention.
export const headquartersPostCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please slow down.' },
});

// Headquarters Network Posts: a Member/Leader toggling their own reaction on
// a post. Own-data-only, idempotent, and expected to fire whenever a Person
// opens a post they want to acknowledge — sized like
// announcementReadLimiter/communityConversationReadLimiter, its own
// dedicated category so a burst of reacting never competes with any other
// mutation category's quota.
export const headquartersPostReactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// In-App Notifications Foundation: marking one notification read. Own-data
// -only, idempotent, expected to fire often as a user opens their
// notification list — same design and magnitude as
// communityConversationReadLimiter/headquartersPostReactionLimiter, its own
// dedicated category so this never competes with any other mutation
// category's quota.
export const notificationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Updates feed (Facebook-style community posts).
export const updatePostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are posting too fast. Please wait a little.' },
});

export const updateCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are commenting too fast. Please wait a little.' },
});

export const updateReactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Friends, blocking, reports and people search (member social features).
export const friendRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are sending too many friend requests. Please wait a little.' },
});

export const socialMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const memberReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports. Please wait a little.' },
});

export const peopleSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please slow down.' },
});
