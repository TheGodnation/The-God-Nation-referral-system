import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { requireCsrf } from '../lib/csrf';
import { createMemberSession } from '../lib/memberAuth';
import { adminSensitiveLimiter } from '../lib/rateLimit';
import { bridgeUserToMemberProfile, setBridgedMemberPassword, MemberBridgeError } from '../lib/memberBridge';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// ---------------------------------------------------------------------------
// Admin <-> Member identity bridge — Section 13/14 of the unified Leader/
// Member identity build. The exact same self-serve mechanism Leaders use
// (leader.ts's /me/create-member-profile, /me/set-member-password), just for
// the Admin's own User: it gains a Person, MemberAccount, friends list, and
// its own personal referral code — "the same functionalities as every other
// person", never the Leadership Dashboard toolset. This bridged Person is
// also the one the Admin designates as Settings.defaultReferrerPersonId,
// the single catch-all every unattributed joiner is auto-friended to (see
// memberAuth.ts). Deliberately separate from leader.ts: Admin keeps its own
// access point, never folded into the Leader router.
// ---------------------------------------------------------------------------

const createMemberProfileSchema = z.object({
  whatsapp: z.string().trim().min(1).max(32),
  password: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100),
  language: z.enum(['en', 'fr']).default('en'),
});

router.post('/me/create-member-profile', adminSensitiveLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createMemberProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'password') {
      return res.status(400).json({ error: issue.message });
    }
    return res.status(400).json({ error: 'Please enter a valid phone number, including the country code.' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: 'Admin not found.' });

  try {
    const { memberAccount, person } = await bridgeUserToMemberProfile(user, parsed.data);

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'ADMIN_SELF_LINKED_MEMBER_PROFILE',
      targetType: 'User',
      targetId: user.id,
      metadata: { personId: person.id, memberAccountId: memberAccount.id },
    });

    // The Admin is already proven to be this account's owner (their
    // existing password session) — sign them into the Member side right
    // now too, rather than send a magic-link email to themselves.
    await createMemberSession(memberAccount.id, res);

    res.status(201).json({ personId: person.id, personName: person.name });
  } catch (err) {
    if (err instanceof MemberBridgeError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}));

const setMemberPasswordSchema = z.object({
  password: z.string().min(8, 'Please choose a password with at least 8 characters.').max(100),
});

router.post('/me/set-member-password', adminSensitiveLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = setMemberPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Please choose a password with at least 8 characters.' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: 'Admin not found.' });

  try {
    const memberAccount = await setBridgedMemberPassword(user, parsed.data.password);

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'ADMIN_MEMBER_PASSWORD_SET',
      targetType: 'MemberAccount',
      targetId: memberAccount.id,
    });

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof MemberBridgeError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}));

export default router;
