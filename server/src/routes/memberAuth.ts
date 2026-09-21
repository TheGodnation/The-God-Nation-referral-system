import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/auth';
import { createMemberSession, destroyMemberSession, requireMember, MEMBER_SESSION_COOKIE_NAME } from '../lib/memberAuth';
import { normalizeToE164 } from '../lib/phone';
import { recordAudit } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';
import { memberLoginRequestLimiter, memberLoginConsumeLimiter } from '../lib/rateLimit';
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

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MEMBER_LOGIN_TOKEN_TTL_MS);

  await prisma.memberLoginToken.create({ data: { memberAccountId: memberAccount.id, tokenHash, expiresAt } });

  const loginUrl = `${CLIENT_URL}/member/login/confirm?token=${rawToken}`;
  const emailResult = await EmailService.sendMemberLoginLink({
    to: memberAccount.email,
    name: person.name,
    language: person.preferredLanguage,
    link: loginUrl,
  });
  // Temporary staging diagnostic (Phase 3C email-delivery investigation):
  // the generic public response below never varies with this outcome, and
  // this never logs the raw token, the login URL, or the recipient address
  // — only whether the send succeeded and, if so, Resend's own message id,
  // which is an opaque identifier used to look up delivery status.
  console.log('[member-auth] login email send attempted', {
    ok: emailResult.ok,
    skipped: emailResult.skipped ?? false,
    resendMessageId: emailResult.id ?? null,
  });

  await recordAudit({
    action: 'MEMBER_LOGIN_LINK_REQUESTED',
    targetType: 'MemberAccount',
    targetId: memberAccount.id,
  });

  return res.json(GENERIC_LINK_RESPONSE);
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
  res.json({ member: { name: req.member.name, email: req.member.email, preferredLanguage: req.member.preferredLanguage } });
});

export default router;
