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

// Phase 3G: Admin Community/Geography create/edit (including reparenting).
// Authenticated, Admin-only, lower enumeration risk than the public
// limiters above, but still a dedicated limiter per the project's "never
// rely solely on generalApiLimiter" convention — matching the magnitude of
// leadershipMutationLimiter, the closest existing precedent for an
// Admin-authenticated structural-mutation category.
export const communityGeographyMutationLimiter = rateLimit({
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
