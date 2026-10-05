import { Router } from 'express';
import crypto from 'crypto';
import { Prisma, type MemberAccount, type Person } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/auth';
import { createMemberSession, destroyMemberSession, requireMember, MEMBER_SESSION_COOKIE_NAME } from '../lib/memberAuth';
import { normalizeToE164 } from '../lib/phone';
import { recordAudit } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';
import {
  memberLoginRequestLimiter,
  memberLoginConsumeLimiter,
  memberSignupLimiter,
  memberCompleteProfileLimiter,
} from '../lib/rateLimit';
import { selectApplicableReferralVisit } from '../lib/attribution';
import { placePersonInGroup } from '../lib/placement';
import { profilePhotoPath } from '../lib/profilePhoto';
import { EmailService } from '../lib/email';
import { CLIENT_URL, MEMBER_LOGIN_TOKEN_TTL_MS } from '../lib/env';
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

function hashCode(tokenId: string, code: string): string {
  return hashToken(`${tokenId}:${code}`);
}

const MAX_CODE_ATTEMPTS = 5;

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
// Public sign-up: step 1 of joining. The visitor gives only their email and
// phone number; we email them a one-time link. Clicking it signs them in and
// the app then asks for their name and location (complete-profile below),
// after which they are placed in a group automatically.
//
// The reply is always the same generic message, whatever happened, so this
// endpoint never reveals whether an email or phone number is already known.
// Someone who is already a member and signs up again simply gets a sign-in
// link at the email already on their account.
// ---------------------------------------------------------------------------

const GENERIC_SIGNUP_RESPONSE = {
  message: 'Check your email: we sent you a link to continue. It works once and expires soon.',
};

const signupSchema = z.object({
  email: z.string().trim().email().max(320),
  whatsapp: z.string().trim().min(1).max(32),
  language: z.enum(['en', 'fr']).default('en'),
});

router.post('/signup', memberSignupLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please enter a valid email address and phone number.', code: 'INVALID_INPUT' });
  }
  const { email, whatsapp, language } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const normalizedWhatsApp = normalizeToE164(whatsapp);
  if (!normalizedWhatsApp) {
    // Says nothing about whether anyone is registered — only that the
    // number itself isn't a valid phone number.
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.', code: 'INVALID_PHONE' });
  }

  const [personByPhone, accountByEmail] = await Promise.all([
    prisma.person.findUnique({ where: { whatsappNumber: normalizedWhatsApp }, include: { memberAccount: true } }),
    prisma.memberAccount.findUnique({ where: { email: normalizedEmail }, include: { person: true } }),
  ]);

  // Case 1: this email already has an account — send the sign-in link to
  // that same inbox (only its owner can use it). Never attach the phone
  // number from this request to anything.
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
        data: { personId: personByPhone.id, email: normalizedEmail },
      });
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
        },
      });
      if (selectedVisit?.referralCodeId) {
        await tx.referralRelationship.create({
          data: {
            leaderId: selectedVisit.referralCode!.leaderId,
            registrationId: registration.id,
            referralCodeId: selectedVisit.referralCodeId,
          },
        });
      }
      await tx.event.create({
        data: { type: 'REGISTERED', registrationId: registration.id, visitorId, isTestData },
      });
      const memberAccount = await tx.memberAccount.create({
        data: { personId: person.id, email: normalizedEmail },
      });
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
// Simple sign-in: email only. POST /api/member/auth/request-code emails a
// 6-digit code (and a link) to that address if it belongs to a member; the
// reply is always the same, so it never reveals who is a member. The
// member then types the code on the same screen: POST verify-code.
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
});

const BAD_CODE = { error: 'That code is not right or has expired. Check the latest email, or ask for a new code.', code: 'BAD_CODE' };

router.post('/verify-code', memberLoginConsumeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(BAD_CODE);

  const account = await prisma.memberAccount.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { person: true },
  });
  if (!account) return res.status(400).json(BAD_CODE);

  // Only the newest still-valid code counts.
  const token = await prisma.memberLoginToken.findFirst({
    where: { memberAccountId: account.id, consumedAt: null, expiresAt: { gt: new Date() }, codeHash: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) return res.status(400).json(BAD_CODE);

  if (hashCode(token.id, parsed.data.code) !== token.codeHash) {
    const attempts = token.codeAttempts + 1;
    await prisma.memberLoginToken.update({
      where: { id: token.id },
      // Too many wrong tries: the code (and its link) stop working.
      data: { codeAttempts: attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { consumedAt: new Date() } : {}) },
    });
    await recordAudit({ action: 'MEMBER_LOGIN_CODE_WRONG', targetType: 'MemberAccount', targetId: account.id, metadata: { attempts } });
    return res.status(400).json(BAD_CODE);
  }

  // Same atomic, single-use claim as the link.
  const claim = await prisma.memberLoginToken.updateMany({
    where: { id: token.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claim.count !== 1) return res.status(400).json(BAD_CODE);

  await prisma.memberAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await createMemberSession(account.id, res);
  await recordAudit({ action: 'MEMBER_LOGIN_SUCCESS', targetType: 'MemberAccount', targetId: account.id, metadata: { via: 'code' } });

  res.json({
    member: {
      name: account.person.name,
      email: account.email,
      preferredLanguage: account.person.preferredLanguage,
    },
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
  });
}));

router.post('/logout', requireCsrf, requireMember, asyncHandler(async (req, res) => {
  if (req.memberSessionToken) {
    await destroyMemberSession(req.memberSessionToken);
  }
  res.clearCookie(MEMBER_SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}));

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

const CAMEROON = 'cameroon';

const detailText = z.string().trim().max(100);

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
