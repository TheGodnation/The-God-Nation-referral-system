import { isCentralAdminPerson } from '../lib/centralAdmin';
import { cancelAccountDeletion } from '../lib/accountDeletion';
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma, type MemberAccount, type Person } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashToken, autoPairLeaderSession } from '../lib/auth';
import { createMemberSession, destroyMemberSession, requireMember, MEMBER_SESSION_COOKIE_NAME } from '../lib/memberAuth';
import { normalizeToE164 } from '../lib/phone';
import { recordAudit, isBruteForced, recordLoginAttempt } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';
import {
  memberLoginRequestLimiter,
  memberLoginConsumeLimiter,
  memberSignupLimiter,
  memberSignupStartLimiter,
  memberSignupCheckCodeLimiter,
  memberSignupFinishLimiter,
  memberCompleteProfileLimiter,
  memberPasswordLoginLimiter,
  memberPasswordHelpLimiter,
} from '../lib/rateLimit';
import { selectApplicableReferralVisit } from '../lib/attribution';
import { placePersonInGroup } from '../lib/placement';
import { getOrCreatePersonReferralCode } from '../lib/referralCode';
import { profilePhotoPath, coverPhotoPath } from '../lib/profilePhoto';
import { EmailService } from '../lib/email';
import { CLIENT_URL, MEMBER_LOGIN_TOKEN_TTL_MS, PENDING_MEMBER_SIGNUP_TTL_MS } from '../lib/env';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

// Identical wording regardless of what actually happened server-side — a
// Person that doesn't exist, an email collision, or a genuine success all
// produce this exact response, so the public endpoint never reveals
// whether a WhatsApp number or email is recognized (Section 7/9/23).
const GENERIC_LINK_RESPONSE = {
  message: 'If that WhatsApp number is registered, a sign-in link has been sent to the email you provided.',
};

// Creates a fresh one-time sign-in token for this account and emails the
// link. Shared by sign-in (request-link) and sign-up (signup).
async function sendMemberLoginLink(memberAccount: MemberAccount, person: Person) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MEMBER_LOGIN_TOKEN_TTL_MS);
  // The same email also carries a 6-digit code (see verify-code below).
  const id = crypto.randomUUID();
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

  await prisma.memberLoginToken.create({
    data: { id, memberAccountId: memberAccount.id, tokenHash, codeHash: hashCode(id, code), expiresAt },
  });

  const loginUrl = `${CLIENT_URL}/member/login/confirm?token=${rawToken}`;
  const isFr = person.preferredLanguage === 'fr';
  // A brand-new sign-up has no real name yet (they give it on the details
  // form after clicking the link), so greet them neutrally.
  const greetingName = person.profileCompletedAt ? person.name : isFr ? 'cher(e) ami(e)' : 'friend';
  await EmailService.sendMemberLoginLink({
    to: memberAccount.email,
    name: greetingName,
    language: person.preferredLanguage,
    link: loginUrl,
    code,
  });

  await recordAudit({
    action: 'MEMBER_LOGIN_LINK_REQUESTED',
    targetType: 'MemberAccount',
    targetId: memberAccount.id,
  });
}

// ----------------------------- Trusted phones --------------------------------
// The central admin's own member profile carries the admin's powers (see
// lib/centralAdmin.ts), so on a phone it has not used before, the password
// alone is not enough: the code emailed to it is needed too. Once that
// code (or the emailed link) is confirmed, the phone keeps a cookie and the
// password alone works there again.
const TRUSTED_DEVICE_COOKIE = 'mtd';
const TRUSTED_DEVICE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

async function isTrustedDevice(req: Request, memberAccountId: string): Promise<boolean> {
  const raw = req.cookies?.[TRUSTED_DEVICE_COOKIE];
  if (typeof raw !== 'string' || raw.length < 20) return false;
  const device = await prisma.trustedMemberDevice.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!device || device.memberAccountId !== memberAccountId) return false;
  await prisma.trustedMemberDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return true;
}

async function trustThisDevice(memberAccountId: string, personId: string, res: Response) {
  if (!(await isCentralAdminPerson(personId))) return;
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.trustedMemberDevice.create({ data: { memberAccountId, tokenHash: hashToken(raw) } });
  res.cookie(TRUSTED_DEVICE_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TRUSTED_DEVICE_MAX_AGE_MS,
    path: '/',
  });
}

/**
 * Signing in while "Delete my account" is waiting (the month, or until the
 * central admin decides) cancels it: the account comes back as it was.
 * Done before the leader session is paired, so a returned leader account
 * is active again first.
 */
async function comeBack(person: { id: string; deletionRequestedAt: Date | null }): Promise<boolean> {
  return person.deletionRequestedAt ? cancelAccountDeletion(person.id, 'MEMBER') : false;
}

function hashCode(tokenId: string, code: string): string {
  return hashToken(`${tokenId}:${code}`);
}

const MAX_CODE_ATTEMPTS = 5;
// How many recently sent codes stay usable at once (sign-in and sign-up):
// enough to cover a few "resend" taps while an email is slow to arrive,
// while keeping the odds of a lucky guess tiny.
const MAX_LIVE_CODES = 5;

// Shared by /complete-profile and the public join flow's /signup/finish
// below — both save the same Cameroon-vs-rest-of-world location shape.
const CAMEROON = 'cameroon';
const detailText = z.string().trim().max(100);

const requestLinkSchema = z.object({
  whatsapp: z.string().trim().min(1).max(32),
  email: z.string().trim().email().max(320),
});

// POST /api/member/auth/request-link — public. See Section 7/8 for the
// exact identity-linking rules this implements.
router.post('/request-link', memberLoginRequestLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = requestLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    // A malformed request still gets the generic response — the shape of
    // the reply must never differ based on what was sent.
    return res.json(GENERIC_LINK_RESPONSE);
  }
  const { whatsapp, email } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const normalizedWhatsApp = normalizeToE164(whatsapp);

  // No raw WhatsApp number or email is ever logged below — only enough to
  // distinguish event types in the audit trail.
  if (!normalizedWhatsApp) {
    return res.json(GENERIC_LINK_RESPONSE);
  }

  const person = await prisma.person.findUnique({ where: { whatsappNumber: normalizedWhatsApp } });
  if (!person) {
    // Section 7 Step 4: do not create anything, do not reveal non-existence.
    return res.json(GENERIC_LINK_RESPONSE);
  }

  let memberAccount = await prisma.memberAccount.findUnique({ where: { personId: person.id } });

  if (!memberAccount) {
    // Section 8: the requested email must not already belong to a
    // DIFFERENT Person's MemberAccount — never silently reassign it.
    const emailOwner = await prisma.memberAccount.findUnique({ where: { email: normalizedEmail } });
    if (emailOwner) {
      await recordAudit({
        action: 'MEMBER_EMAIL_COLLISION_ATTEMPT',
        targetType: 'Person',
        targetId: person.id,
      });
      return res.json(GENERIC_LINK_RESPONSE);
    }

    memberAccount = await prisma.memberAccount.create({
      data: { personId: person.id, email: normalizedEmail },
    });

    await recordAudit({
      action: 'MEMBER_ACCOUNT_CREATED',
      targetType: 'MemberAccount',
      targetId: memberAccount.id,
      metadata: { personId: person.id },
    });
  } else if (memberAccount.email !== normalizedEmail) {
    // An existing account already has a different email on file. Changing
    // it here — based on nothing but an unauthenticated claim — would let
    // anyone who knows a Person's WhatsApp number redirect that Person's
    // login emails to an inbox they control. Preserve account ownership
    // integrity: do nothing further, same generic response.
    await recordAudit({
      action: 'MEMBER_EMAIL_MISMATCH_ATTEMPT',
      targetType: 'MemberAccount',
      targetId: memberAccount.id,
    });
    return res.json(GENERIC_LINK_RESPONSE);
  }

  await sendMemberLoginLink(memberAccount, person);

  return res.json(GENERIC_LINK_RESPONSE);
}));

// ---------------------------------------------------------------------------
// Public sign-up: step 1 of joining. The visitor gives their email, phone
// number and a password; we email them a one-time link/code to confirm the
// address. Clicking it (or typing the code) signs them in and the app then
// asks for their name and location (complete-profile below), after which
// they are placed in a group automatically. From then on they sign back in
// with the email + password given here (POST /login below) — a code is
// never sent again just to sign in; see /request-code further down for the
// one remaining case a code is still emailed after sign-up (forgot/never
// set a password).
//
// The reply is always the same generic message, whatever happened, so this
// endpoint never reveals whether an email or phone number is already known.
// Someone who is already a member and signs up again simply gets a sign-in
// link at the email already on their account (their existing password is
// never touched by this).
// ---------------------------------------------------------------------------

const GENERIC_SIGNUP_RESPONSE = {
  message: 'Check your email: we sent you a link to continue. It works once and expires soon.',
};

const signupSchema = z.object({
  email: z.string().trim().email().max(320),
  whatsapp: z.string().trim().min(1).max(32),
  password: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100),
  language: z.enum(['en', 'fr']).default('en'),
});

router.post('/signup', memberSignupLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'password') {
      return res.status(400).json({ error: issue.message, code: 'INVALID_PASSWORD' });
    }
    return res.status(400).json({ error: 'Please enter a valid email address and phone number.', code: 'INVALID_INPUT' });
  }
  const { email, whatsapp, password, language } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const normalizedWhatsApp = normalizeToE164(whatsapp);
  if (!normalizedWhatsApp) {
    // Says nothing about whether anyone is registered — only that the
    // number itself isn't a valid phone number.
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.', code: 'INVALID_PHONE' });
  }
  // Hashed once up front; every branch below that actually creates a
  // MemberAccount uses this. The one branch that doesn't (email already has
  // an account) must never touch that account's existing password from an
  // unauthenticated request — see its comment below.
  const passwordHash = await bcrypt.hash(password, 12);

  const [personByPhone, accountByEmail] = await Promise.all([
    prisma.person.findUnique({ where: { whatsappNumber: normalizedWhatsApp }, include: { memberAccount: true } }),
    prisma.memberAccount.findUnique({ where: { email: normalizedEmail }, include: { person: true } }),
  ]);

  // Case 1: this email already has an account — send the sign-in link to
  // that same inbox (only its owner can use it). Never attach the phone
  // number OR the password from this request to anything: an anonymous
  // "signup" submission is not proof of ownership, so it must never change
  // an existing account's password (that would be a password-reset
  // bypassing any verification). The account's real owner uses "forgot
  // password" (request-code + verify-code with newPassword) instead.
  if (accountByEmail) {
    await sendMemberLoginLink(accountByEmail, accountByEmail.person);
    return res.json(GENERIC_SIGNUP_RESPONSE);
  }

  // Case 2: the phone number is known (for example someone who first
  // registered through the old WhatsApp form).
  if (personByPhone) {
    if (personByPhone.memberAccount) {
      // The number already has an account with a DIFFERENT email. Never
      // redirect someone's sign-in emails based on an unverified claim.
      await recordAudit({
        action: 'MEMBER_EMAIL_MISMATCH_ATTEMPT',
        targetType: 'MemberAccount',
        targetId: personByPhone.memberAccount.id,
      });
      return res.json(GENERIC_SIGNUP_RESPONSE);
    }
    try {
      const memberAccount = await prisma.memberAccount.create({
        data: { personId: personByPhone.id, email: normalizedEmail, passwordHash },
      });
      await getOrCreatePersonReferralCode(prisma, personByPhone.id, personByPhone.name);
      await recordAudit({
        action: 'MEMBER_ACCOUNT_CREATED',
        targetType: 'MemberAccount',
        targetId: memberAccount.id,
        metadata: { personId: personByPhone.id, via: 'signup' },
      });
      await sendMemberLoginLink(memberAccount, personByPhone);
    } catch (err) {
      // A concurrent request claimed the same email/person first.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return res.json(GENERIC_SIGNUP_RESPONSE);
  }

  // Case 3: brand-new person. Record the registration with the same
  // referral/ad attribution the old WhatsApp form used, so referral links
  // and ad tracking keep working.
  const visitorId = req.visitorId!;
  const selectedVisit = await selectApplicableReferralVisit(visitorId);
  const isTestData = selectedVisit?.isTestData ?? false;
  // A ReferralCode may carry Leader attribution (leaderId), Member-owned
  // auto-friending (personId), or — once a Member has been assigned as
  // Leader — both at once on the very same code (see schema.prisma's
  // ReferralCode comment). The two branches below are independent, not
  // mutually exclusive.
  const referralCode = selectedVisit?.referralCode ?? null;
  // No referral code at all (a direct/organic join): fall back to the
  // single designated catch-all Person so nobody is ever truly
  // unattributed (Settings.defaultReferrerPersonId).
  const catchAllPersonId = referralCode
    ? null
    : (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { defaultReferrerPersonId: true } }))
        ?.defaultReferrerPersonId ?? null;
  // Placeholder until the member gives their real name on the details form.
  const placeholderName = normalizedEmail;

  try {
    const { memberAccount, person } = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          name: placeholderName,
          whatsappNumber: normalizedWhatsApp,
          email: normalizedEmail,
          preferredLanguage: language,
          isTestData,
        },
      });
      const registration = await tx.registration.create({
        data: {
          visitorId,
          normalizedWhatsApp,
          name: placeholderName,
          email: normalizedEmail,
          language,
          pathway: 'DISCOVER_GROW',
          utmSource: selectedVisit?.utmSource ?? null,
          utmMedium: selectedVisit?.utmMedium ?? null,
          utmCampaign: selectedVisit?.utmCampaign ?? null,
          landingPage: selectedVisit?.landingPage ?? null,
          isTestData,
          personId: person.id,
          referredByPersonId: referralCode?.personId ?? catchAllPersonId,
        },
      });
      if (referralCode?.leaderId) {
        await tx.referralRelationship.create({
          data: {
            leaderId: referralCode.leaderId,
            registrationId: registration.id,
            referralCodeId: referralCode.id,
          },
        });
      }
      // Joined through a Member-owned (or now dual-purpose Leader+Member)
      // link, or via the catch-all: auto-friend, forward-only from here —
      // never retroactive, and never for the old Leader landing-page/
      // WhatsApp-redirect funnel (registrations.ts, now removed), only this
      // real in-app Member signup.
      const autoFriendPersonId = referralCode?.personId ?? catchAllPersonId;
      if (autoFriendPersonId) {
        await tx.friendship.create({
          data: {
            requesterPersonId: autoFriendPersonId,
            addresseePersonId: person.id,
            status: 'ACCEPTED',
            respondedAt: new Date(),
            origin: 'REFERRAL',
          },
        });
      }
      await tx.event.create({
        data: { type: 'REGISTERED', registrationId: registration.id, visitorId, isTestData },
      });
      const memberAccount = await tx.memberAccount.create({
        data: { personId: person.id, email: normalizedEmail, passwordHash },
      });
      await getOrCreatePersonReferralCode(tx, person.id, placeholderName);
      return { memberAccount, person };
    });

    await recordAudit({
      action: 'MEMBER_ACCOUNT_CREATED',
      targetType: 'MemberAccount',
      targetId: memberAccount.id,
      metadata: { personId: person.id, via: 'signup' },
    });
    await sendMemberLoginLink(memberAccount, person);
  } catch (err) {
    // Unique clash (same phone/email submitted twice at once, or an old
    // registration row for this number) — same generic reply, never a 500.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    console.warn('[member-signup] duplicate sign-up attempt', { visitorId });
  }

  return res.json(GENERIC_SIGNUP_RESPONSE);
}));

// ---------------------------------------------------------------------------
// Public join flow (/register): the 3-screen path visitors reach from a
// Leader/Member referral link or the homepage's Training/Discover&Grow CTA.
// Screen 1 (start) collects only email + password + pathway + language and
// saves nothing but a PendingMemberSignup row while a 6-digit code is
// emailed. Screen 2 (check-code) verifies that code without consuming it,
// for fast feedback. Screen 3 (finish) collects name + phone + location —
// submitting it is the one moment a real Person + MemberAccount +
// Registration (+ referral attribution + community placement) are created,
// atomically, and the visitor is signed in. Re-POSTing start with the same
// email simply replaces the pending row with a fresh code (used for both
// "start over" and "resend code").
// ---------------------------------------------------------------------------

const signupStartSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100),
  pathway: z.enum(['TRAINING', 'DISCOVER_GROW']),
  language: z.enum(['en', 'fr']).default('en'),
});

const EMAIL_ALREADY_REGISTERED = {
  error: 'This email already has an account. Please sign in instead.',
  code: 'EMAIL_ALREADY_REGISTERED',
};

router.post('/signup/start', memberSignupStartLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = signupStartSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'password') {
      return res.status(400).json({ error: issue.message, code: 'INVALID_PASSWORD' });
    }
    return res.status(400).json({ error: 'Please enter a valid email address.', code: 'INVALID_INPUT' });
  }
  const { password, pathway, language } = parsed.data;
  const normalizedEmail = parsed.data.email.toLowerCase();

  // Unlike the old /signup above, this is a brand-new public join flow with
  // no identity-linking history to protect — telling a visitor their email
  // already has an account (so they should sign in instead) is ordinary,
  // expected product UX, not an enumeration risk worth hiding.
  const accountByEmail = await prisma.memberAccount.findUnique({ where: { email: normalizedEmail } });
  if (accountByEmail) {
    return res.status(409).json(EMAIL_ALREADY_REGISTERED);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const visitorId = req.visitorId!;
  const existing = await prisma.pendingMemberSignup.findUnique({ where: { email: normalizedEmail } });
  const id = existing?.id ?? crypto.randomUUID();
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const codeHash = hashCode(id, code);
  const expiresAt = new Date(Date.now() + PENDING_MEMBER_SIGNUP_TTL_MS);
  // A resend keeps the earlier codes of a still-live sign-up usable. An
  // expired or locked one (too many wrong tries) starts clean.
  const previousCodeHashes =
    existing && existing.expiresAt > new Date()
      ? [existing.codeHash, ...existing.previousCodeHashes].slice(0, MAX_LIVE_CODES - 1)
      : [];

  await prisma.pendingMemberSignup.upsert({
    where: { email: normalizedEmail },
    create: { id, email: normalizedEmail, passwordHash, pathway, language, visitorId, codeHash, expiresAt },
    update: { passwordHash, pathway, language, visitorId, codeHash, previousCodeHashes, codeAttempts: 0, expiresAt },
  });

  await EmailService.sendMemberSignupCode({ to: normalizedEmail, language, code });
  await recordAudit({ action: 'MEMBER_SIGNUP_STARTED', targetType: 'PendingMemberSignup', targetId: id });

  return res.json({ message: "We've sent a 6-digit code to your email. Enter it to continue." });
}));

const BAD_SIGNUP_CODE = {
  error: 'That code is not right or has expired. Check the latest email, or ask for a new code.',
  code: 'BAD_CODE',
};

// Records a wrong try against the pending row (locking it after
// MAX_CODE_ATTEMPTS, exactly like MemberLoginToken above) and returns
// whether the given code was actually correct.
async function checkPendingSignupCode(
  pending: { id: string; codeHash: string; previousCodeHashes: string[]; codeAttempts: number },
  code: string,
): Promise<boolean> {
  const hash = hashCode(pending.id, code);
  if (hash === pending.codeHash || pending.previousCodeHashes.includes(hash)) return true;
  const attempts = pending.codeAttempts + 1;
  await prisma.pendingMemberSignup.update({
    where: { id: pending.id },
    data: { codeAttempts: attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { expiresAt: new Date() } : {}) },
  });
  return false;
}

const checkCodeSchema = z.object({
  email: z.string().trim().email().max(320),
  code: z.string().trim().regex(/^\d{6}$/),
});

router.post('/signup/check-code', memberSignupCheckCodeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = checkCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(BAD_SIGNUP_CODE);
  const normalizedEmail = parsed.data.email.toLowerCase();

  const pending = await prisma.pendingMemberSignup.findUnique({ where: { email: normalizedEmail } });
  if (!pending || pending.expiresAt < new Date()) return res.status(400).json(BAD_SIGNUP_CODE);

  if (!(await checkPendingSignupCode(pending, parsed.data.code))) {
    return res.status(400).json(BAD_SIGNUP_CODE);
  }

  return res.json({ valid: true });
}));

const signupFinishSchema = z
  .object({
    email: z.string().trim().email().max(320),
    code: z.string().trim().regex(/^\d{6}$/),
    name: z.string().trim().min(1).max(200),
    whatsapp: z.string().trim().min(1).max(32),
    country: z.string().trim().min(1).max(100),
    region: detailText.optional(),
    division: detailText.optional(),
    subdivision: detailText.optional(),
    quarter: detailText.optional(),
    city: detailText.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.country.toLowerCase() === CAMEROON) {
      for (const key of ['region', 'division', 'subdivision', 'quarter'] as const) {
        if (!d[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Please enter your ${key}.` });
      }
    } else if (!d.city) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['city'], message: 'Please enter your city or town.' });
    }
  });

router.post('/signup/finish', memberSignupFinishLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = signupFinishSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue?.message ?? 'Please check your details.', field: issue?.path?.[0] ?? null });
  }
  const d = parsed.data;
  const normalizedEmail = d.email.toLowerCase();
  const normalizedWhatsApp = normalizeToE164(d.whatsapp);
  if (!normalizedWhatsApp) {
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.', code: 'INVALID_PHONE' });
  }

  const pending = await prisma.pendingMemberSignup.findUnique({ where: { email: normalizedEmail } });
  if (!pending || pending.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Your code has expired. Please start again.', code: 'BAD_CODE' });
  }
  if (!(await checkPendingSignupCode(pending, d.code))) {
    return res.status(400).json(BAD_SIGNUP_CODE);
  }

  const inCameroon = d.country.toLowerCase() === CAMEROON;
  const locationData = {
    locationCountry: d.country,
    locationRegion: inCameroon ? d.region! : null,
    locationDivision: inCameroon ? d.division! : null,
    locationSubdivision: inCameroon ? d.subdivision! : null,
    locationQuarter: inCameroon ? d.quarter! : null,
    locationCity: inCameroon ? d.division! : d.city!,
    locationArea: inCameroon ? d.quarter! : null,
  };

  // Someone who already joined only through the old WhatsApp-redirect form
  // (Person, no MemberAccount) and is now finishing the real join flow with
  // the same phone number: reuse that Person rather than erroring, same
  // "Case 2" precedent as the old /signup above. A phone number that
  // already has a MemberAccount, though, is a genuine duplicate attempt.
  const existingPersonByPhone = await prisma.person.findUnique({
    where: { whatsappNumber: normalizedWhatsApp },
    include: { memberAccount: true },
  });
  if (existingPersonByPhone?.memberAccount) {
    return res.status(409).json({
      error: 'This phone number already belongs to an existing account. Please sign in instead.',
      code: 'PHONE_ALREADY_REGISTERED',
    });
  }

  const selectedVisit = await selectApplicableReferralVisit(pending.visitorId);
  const isTestData = selectedVisit?.isTestData ?? false;
  // See the identical comment in /signup above: leaderId and personId
  // attribution are independent, and a missing referralCode falls back to
  // the single catch-all Person so nobody is ever truly unattributed.
  const referralCode = selectedVisit?.referralCode ?? null;
  const catchAllPersonId = referralCode
    ? null
    : (await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { defaultReferrerPersonId: true } }))
        ?.defaultReferrerPersonId ?? null;

  let memberAccount: MemberAccount;
  let person: Person;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const txPerson = existingPersonByPhone
        ? await tx.person.update({
            where: { id: existingPersonByPhone.id },
            data: { name: d.name, email: normalizedEmail, preferredLanguage: pending.language, profileCompletedAt: new Date(), ...locationData },
          })
        : await tx.person.create({
            data: {
              name: d.name,
              whatsappNumber: normalizedWhatsApp,
              email: normalizedEmail,
              preferredLanguage: pending.language,
              isTestData,
              profileCompletedAt: new Date(),
              ...locationData,
            },
          });

      const registration = await tx.registration.create({
        data: {
          visitorId: pending.visitorId,
          normalizedWhatsApp,
          name: d.name,
          email: normalizedEmail,
          language: pending.language,
          pathway: pending.pathway,
          utmSource: selectedVisit?.utmSource ?? null,
          utmMedium: selectedVisit?.utmMedium ?? null,
          utmCampaign: selectedVisit?.utmCampaign ?? null,
          landingPage: selectedVisit?.landingPage ?? null,
          isTestData,
          personId: txPerson.id,
          referredByPersonId: referralCode?.personId ?? catchAllPersonId,
        },
      });

      if (referralCode?.leaderId) {
        await tx.referralRelationship.create({
          data: { leaderId: referralCode.leaderId, registrationId: registration.id, referralCodeId: referralCode.id },
        });
      }
      const autoFriendPersonId = referralCode?.personId ?? catchAllPersonId;
      if (autoFriendPersonId) {
        await tx.friendship.create({
          data: {
            requesterPersonId: autoFriendPersonId,
            addresseePersonId: txPerson.id,
            status: 'ACCEPTED',
            respondedAt: new Date(),
            origin: 'REFERRAL',
          },
        });
      }

      await tx.event.create({
        data: { type: 'REGISTERED', registrationId: registration.id, visitorId: pending.visitorId, isTestData },
      });

      const txMemberAccount = await tx.memberAccount.create({
        data: { personId: txPerson.id, email: normalizedEmail, passwordHash: pending.passwordHash },
      });

      await getOrCreatePersonReferralCode(tx, txPerson.id, d.name);

      await tx.pendingMemberSignup.delete({ where: { id: pending.id } });

      return { memberAccount: txMemberAccount, person: txPerson };
    });
    memberAccount = result.memberAccount;
    person = result.person;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({
        error: 'That email or phone number is already in use. Please sign in instead.',
        code: 'DUPLICATE',
      });
    }
    throw err;
  }

  const communityId = await placePersonInGroup(person.id, { country: person.locationCountry, region: person.locationRegion });
  const community = communityId
    ? await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, name: true } })
    : null;

  await recordAudit({
    action: 'MEMBER_ACCOUNT_CREATED',
    targetType: 'MemberAccount',
    targetId: memberAccount.id,
    metadata: { personId: person.id, via: 'signup-finish' },
  });
  await recordAudit({
    action: 'MEMBER_PROFILE_COMPLETED',
    targetType: 'Person',
    targetId: person.id,
    metadata: { placedInCommunityId: communityId },
  });

  await createMemberSession(memberAccount.id, res);
  await autoPairLeaderSession(person.id, res);

  res.json({
    member: { name: person.name, email: memberAccount.email, preferredLanguage: person.preferredLanguage },
    community,
  });
}));

// ---------------------------------------------------------------------------
// Sign-in: email + password. The ordinary, repeatable way a Member who has
// already signed up gets back in — no email, no code, every time. Same
// generic failure reply whether the email isn't a member, the account has
// no password yet (signed up before this existed), or the password is
// simply wrong: never reveals which. A member in that middle case uses
// "forgot password" (request-code + verify-code with newPassword, below)
// to set one; the login page always offers that link, not just when this
// endpoint happens to fail, so offering it is never itself a signal.
// ---------------------------------------------------------------------------

const memberLoginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1),
});

const BAD_MEMBER_LOGIN = { error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' };

router.post('/login', memberPasswordLoginLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = memberLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(BAD_MEMBER_LOGIN);
  const { password } = parsed.data;
  const normalizedEmail = parsed.data.email.toLowerCase();
  // Namespaced so a Member's failed attempts never share a brute-force
  // bucket with an Admin/Leader User of the same email address.
  const bruteForceId = `member:${normalizedEmail}`;
  const ip = req.ip;
  const userAgent = req.header('user-agent');

  if (await isBruteForced(bruteForceId)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please try again later.' });
  }

  const account = await prisma.memberAccount.findUnique({
    where: { email: normalizedEmail },
    include: { person: true },
  });

  if (!account || !account.passwordHash || !(await bcrypt.compare(password, account.passwordHash))) {
    await recordLoginAttempt(bruteForceId, false, ip, userAgent);
    return res.status(401).json(BAD_MEMBER_LOGIN);
  }

  // The central admin's own profile on a new phone: the emailed code too.
  if ((await isCentralAdminPerson(account.personId)) && !(await isTrustedDevice(req, account.id))) {
    await recordLoginAttempt(bruteForceId, true, ip, userAgent);
    await sendMemberLoginLink(account, account.person);
    await recordAudit({ action: 'MEMBER_LOGIN_CODE_REQUIRED', targetType: 'MemberAccount', targetId: account.id });
    return res.json({ codeRequired: true });
  }

  await prisma.memberAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await recordLoginAttempt(bruteForceId, true, ip, userAgent);
  await createMemberSession(account.id, res);
  const deletionCancelled = await comeBack(account.person);
  await autoPairLeaderSession(account.personId, res);
  await recordAudit({ action: 'MEMBER_LOGIN_SUCCESS', targetType: 'MemberAccount', targetId: account.id, metadata: { via: 'password' } });

  res.json({
    member: {
      name: account.person.name,
      email: account.email,
      preferredLanguage: account.person.preferredLanguage,
    },
    ...(deletionCancelled ? { deletionCancelled: true } : {}),
  });
}));

// ---------------------------------------------------------------------------
// Forgot password / never set one: POST /api/member/auth/request-code emails
// a 6-digit code (and a link) to that address if it belongs to a member; the
// reply is always the same, so it never reveals who is a member. The member
// then types the code (and their new password) on the same screen: POST
// verify-code with newPassword. This is also still how a brand-new sign-up
// confirms their email right after signing up (verify-code without
// newPassword, since they already set one above) — the only two places a
// code is ever sent.
// ---------------------------------------------------------------------------

const GENERIC_CODE_RESPONSE = {
  message: 'If this email belongs to a member, we sent a 6-digit code to it.',
};

const requestCodeSchema = z.object({ email: z.string().trim().email().max(320) });

router.post('/request-code', memberLoginRequestLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = requestCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please enter a valid email address.', code: 'INVALID_EMAIL' });
  }
  const account = await prisma.memberAccount.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { person: true },
  });
  if (account) await sendMemberLoginLink(account, account.person);
  return res.json(GENERIC_CODE_RESPONSE);
}));

const verifyCodeSchema = z.object({
  email: z.string().trim().email().max(320),
  code: z.string().trim().regex(/^\d{6}$/),
  // Present only on the "forgot password / never set one" screen — sets
  // (or replaces) the account's password in the same step as verifying the
  // code. Absent on the plain post-signup "confirm your email" screen,
  // where a password was already set at signup.
  newPassword: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100).optional(),
});

const BAD_CODE = { error: 'That code is not right or has expired. Check the latest email, or ask for a new code.', code: 'BAD_CODE' };

router.post('/verify-code', memberLoginConsumeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'newPassword') {
      return res.status(400).json({ error: issue.message, code: 'INVALID_PASSWORD' });
    }
    return res.status(400).json(BAD_CODE);
  }

  const account = await prisma.memberAccount.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { person: true },
  });
  if (!account) return res.status(400).json(BAD_CODE);

  // Any of the recent still-valid codes counts, not just the newest: on a
  // slow connection the first email often lands after the member has
  // already asked for another, and the code they then type is that first
  // one.
  const tokens = await prisma.memberLoginToken.findMany({
    where: { memberAccountId: account.id, consumedAt: null, expiresAt: { gt: new Date() }, codeHash: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: MAX_LIVE_CODES,
  });
  if (tokens.length === 0) return res.status(400).json(BAD_CODE);

  const token = tokens.find((t) => hashCode(t.id, parsed.data.code) === t.codeHash);
  if (!token) {
    // A wrong try counts against every code still in play, so asking for
    // more codes never buys extra guesses at the older ones.
    for (const t of tokens) {
      const attempts = t.codeAttempts + 1;
      await prisma.memberLoginToken.update({
        where: { id: t.id },
        // Too many wrong tries: the code (and its link) stop working.
        data: { codeAttempts: attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      });
    }
    await recordAudit({
      action: 'MEMBER_LOGIN_CODE_WRONG',
      targetType: 'MemberAccount',
      targetId: account.id,
      metadata: { attempts: tokens[0].codeAttempts + 1 },
    });
    return res.status(400).json(BAD_CODE);
  }

  // Same atomic, single-use claim as the link.
  const claim = await prisma.memberLoginToken.updateMany({
    where: { id: token.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claim.count !== 1) return res.status(400).json(BAD_CODE);
  // Signed in — the member's other outstanding codes (and their links) are
  // no longer needed.
  await prisma.memberLoginToken.updateMany({
    where: { memberAccountId: account.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const { newPassword } = parsed.data;
  const newPasswordHash = newPassword ? await bcrypt.hash(newPassword, 12) : undefined;
  await prisma.memberAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date(), ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}) },
  });
  await createMemberSession(account.id, res);
  await trustThisDevice(account.id, account.personId, res);
  const deletionCancelled = await comeBack(account.person);
  await autoPairLeaderSession(account.personId, res);
  await recordAudit({ action: 'MEMBER_LOGIN_SUCCESS', targetType: 'MemberAccount', targetId: account.id, metadata: { via: 'code' } });
  if (newPasswordHash) {
    await recordAudit({ action: 'MEMBER_PASSWORD_SET', targetType: 'MemberAccount', targetId: account.id });
  }

  res.json({
    member: {
      name: account.person.name,
      email: account.email,
      preferredLanguage: account.person.preferredLanguage,
    },
    ...(deletionCancelled ? { deletionCancelled: true } : {}),
  });
}));

const consumeSchema = z.object({ token: z.string().min(1) });

// POST /api/member/auth/consume — public. Never reveals whether a specific
// token ever existed; every failure path returns the same generic message.
router.post('/consume', memberLoginConsumeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = consumeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'This sign-in link is invalid or has expired. Please request a new one.' });
  }
  const tokenHash = hashToken(parsed.data.token);

  // Atomic claim: only a request that flips consumedAt from null to a
  // timestamp on a still-valid row can ever succeed. A concurrent replay of
  // the exact same raw token races against this UPDATE, not a separate
  // read-then-write, so at most one of them can ever get count === 1.
  const claim = await prisma.memberLoginToken.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  if (claim.count !== 1) {
    return res.status(400).json({ error: 'This sign-in link is invalid or has expired. Please request a new one.' });
  }

  const loginToken = await prisma.memberLoginToken.findUnique({ where: { tokenHash } });
  const memberAccount = await prisma.memberAccount.findUnique({
    where: { id: loginToken!.memberAccountId },
    include: { person: true },
  });
  if (!memberAccount) {
    // Should not happen (FK cascade would have removed the token too), but
    // never assume — fail closed with the same generic message.
    return res.status(400).json({ error: 'This sign-in link is invalid or has expired. Please request a new one.' });
  }

  await prisma.memberAccount.update({ where: { id: memberAccount.id }, data: { lastLoginAt: new Date() } });
  await createMemberSession(memberAccount.id, res);
  await trustThisDevice(memberAccount.id, memberAccount.personId, res);
  const deletionCancelled = await comeBack(memberAccount.person);
  await autoPairLeaderSession(memberAccount.personId, res);

  await recordAudit({
    action: 'MEMBER_LOGIN_SUCCESS',
    targetType: 'MemberAccount',
    targetId: memberAccount.id,
  });

  res.json({
    member: {
      name: memberAccount.person.name,
      email: memberAccount.email,
      preferredLanguage: memberAccount.person.preferredLanguage,
    },
    ...(deletionCancelled ? { deletionCancelled: true } : {}),
  });
}));

// ---------------------------------------------------------------------------
// "Help them sign in" — the private link the central admin sends on WhatsApp
// (Admin → People; see adminPeople.ts). It works once, for 24 hours: the
// member chooses a new password and is signed in.
// ---------------------------------------------------------------------------

const BAD_HELP_LINK = { error: 'This link has expired or was already used. Ask the central admin for a new one.', code: 'BAD_LINK' };

async function liveHelpLink(rawToken: unknown) {
  if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) return null;
  const link = await prisma.memberPasswordHelpLink.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { memberAccount: { include: { person: true } } },
  });
  if (!link || link.usedAt || link.expiresAt <= new Date()) {
    console.info('[password-help] refused', JSON.stringify({
      ref: hashToken(rawToken).slice(0, 10),
      tokenLength: rawToken.length,
      reason: !link ? 'not_found' : link.usedAt ? 'already_used' : 'expired',
    }));
    return null;
  }
  // The central admin's profile never signs in without the emailed code.
  if (await isCentralAdminPerson(link.memberAccount.personId)) return null;
  return link;
}

// GET /api/member/auth/password-help?token= — whose link this is (first name
// shown on the page, so they know it is for them).
router.get('/password-help', memberPasswordHelpLimiter, asyncHandler(async (req, res) => {
  const link = await liveHelpLink(req.query.token);
  if (!link) return res.status(400).json(BAD_HELP_LINK);
  res.json({ name: link.memberAccount.person.name, email: link.memberAccount.email, expiresAt: link.expiresAt });
}));

const passwordHelpSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long.').max(200),
});

// POST /api/member/auth/password-help — the new password; signs them in and
// signs out every other phone that was still signed in to the account.
router.post('/password-help', memberPasswordHelpLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = passwordHelpSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'newPassword') return res.status(400).json({ error: issue.message, code: 'INVALID_PASSWORD' });
    return res.status(400).json(BAD_HELP_LINK);
  }
  const link = await liveHelpLink(parsed.data.token);
  if (!link) return res.status(400).json(BAD_HELP_LINK);
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  // Atomic, single-use claim (as with the emailed sign-in link).
  const claim = await prisma.memberPasswordHelpLink.updateMany({
    where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claim.count !== 1) return res.status(400).json(BAD_HELP_LINK);

  const account = link.memberAccount;
  await prisma.$transaction([
    prisma.memberAccount.update({ where: { id: account.id }, data: { passwordHash, lastLoginAt: new Date() } }),
    prisma.memberSession.deleteMany({ where: { memberAccountId: account.id } }),
    // Any other help link sent to them stops working now.
    prisma.memberPasswordHelpLink.updateMany({ where: { memberAccountId: account.id, usedAt: null }, data: { usedAt: new Date() } }),
    // Codes still waiting in their mailbox are no longer needed.
    prisma.memberLoginToken.updateMany({ where: { memberAccountId: account.id, consumedAt: null }, data: { consumedAt: new Date() } }),
  ]);
  await createMemberSession(account.id, res);
  const deletionCancelled = await comeBack(account.person);
  await autoPairLeaderSession(account.personId, res);
  await recordAudit({ action: 'MEMBER_PASSWORD_SET', targetType: 'MemberAccount', targetId: account.id, metadata: { via: 'admin_help_link' } });

  res.json({
    member: {
      name: account.person.name,
      email: account.email,
      preferredLanguage: account.person.preferredLanguage,
    },
    ...(deletionCancelled ? { deletionCancelled: true } : {}),
  });
}));

router.post('/logout', requireCsrf, requireMember, asyncHandler(async (req, res) => {
  if (req.memberSessionToken) {
    await destroyMemberSession(req.memberSessionToken);
  }
  res.clearCookie(MEMBER_SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}));

// GET /api/member/auth/ping — the member app calls this every 30 seconds
// while it is open, so others can see "online" (loadMemberSession records
// the visit). Answers whether the session is still signed in.
router.get('/ping', (req, res) => {
  res.json({ ok: Boolean(req.member) });
});

router.get('/me', (req, res) => {
  if (!req.member) return res.json({ member: null });
  res.json({
    member: {
      name: req.member.name,
      email: req.member.email,
      preferredLanguage: req.member.preferredLanguage,
      locationCountry: req.member.locationCountry,
      locationCity: req.member.locationCity,
      locationArea: req.member.locationArea,
      locationRegion: req.member.locationRegion,
      locationDivision: req.member.locationDivision,
      locationSubdivision: req.member.locationSubdivision,
      locationQuarter: req.member.locationQuarter,
      // false only for a brand-new sign-up who hasn't filled in the
      // details form yet — the app sends them there first.
      profileComplete: req.member.profileCompletedAt !== null,
      personId: req.member.personId,
      photoUrl: profilePhotoPath({
        id: req.member.personId,
        photoStorageKey: req.member.photoStorageKey,
        photoUpdatedAt: req.member.photoUpdatedAt,
      }),
      coverUrl: coverPhotoPath({
        id: req.member.personId,
        coverStorageKey: req.member.coverStorageKey ?? null,
        coverUpdatedAt: req.member.coverUpdatedAt ?? null,
      }),
      bio: req.member.bio ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// Sign-up step 2: the details form shown right after the member clicks
// their emailed link. Saves name and location, marks the profile complete,
// and places the member in a group automatically (see lib/placement.ts).
// Calling it again later just updates the details; it never moves someone
// who already has a group.
// ---------------------------------------------------------------------------

const completeProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    preferredLanguage: z.enum(['en', 'fr']).optional(),
    country: z.string().trim().min(1).max(100),
    region: detailText.optional(),
    division: detailText.optional(),
    subdivision: detailText.optional(),
    quarter: detailText.optional(),
    city: detailText.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.country.toLowerCase() === CAMEROON) {
      for (const key of ['region', 'division', 'subdivision', 'quarter'] as const) {
        if (!d[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Please enter your ${key}.` });
      }
    } else if (!d.city) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['city'], message: 'Please enter your city or town.' });
    }
  });

router.post('/complete-profile', memberCompleteProfileLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = completeProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue?.message ?? 'Please check your details.', field: issue?.path?.[0] ?? null });
  }
  const d = parsed.data;
  const inCameroon = d.country.toLowerCase() === CAMEROON;
  const personId = req.member!.personId;

  const person = await prisma.person.update({
    where: { id: personId },
    data: {
      name: d.name,
      ...(d.preferredLanguage ? { preferredLanguage: d.preferredLanguage } : {}),
      locationCountry: d.country,
      // For Cameroon the "city" column holds the division and "area" the
      // quarter, so older screens that only know country/city/area still
      // show something sensible.
      locationRegion: inCameroon ? d.region! : null,
      locationDivision: inCameroon ? d.division! : null,
      locationSubdivision: inCameroon ? d.subdivision! : null,
      locationQuarter: inCameroon ? d.quarter! : null,
      locationCity: inCameroon ? d.division! : d.city!,
      locationArea: inCameroon ? d.quarter! : null,
      profileCompletedAt: req.member!.profileCompletedAt ?? new Date(),
    },
  });

  // Keep the original registration row's name in step with the real name
  // (it was created with a placeholder at sign-up).
  await prisma.registration.updateMany({
    where: { personId, name: req.member!.email },
    data: { name: d.name },
  });

  const communityId = await placePersonInGroup(personId, { country: person.locationCountry, region: person.locationRegion });
  const community = communityId
    ? await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, name: true } })
    : null;

  await recordAudit({
    action: 'MEMBER_PROFILE_COMPLETED',
    targetType: 'Person',
    targetId: personId,
    metadata: { placedInCommunityId: communityId },
  });

  res.json({ profileComplete: true, community });
}));

export default router;
