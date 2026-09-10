import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import {
  createSession,
  destroySession,
  destroyAllSessionsForUser,
  hashToken,
  requireAuth,
  SESSION_COOKIE_NAME,
} from '../lib/auth';
import { isBruteForced, recordLoginAttempt, recordAudit } from '../lib/audit';
import {
  loginLimiter,
  leaderSetupLimiter,
  passwordResetRequestLimiter,
  passwordResetRedeemLimiter,
} from '../lib/rateLimit';
import { requireCsrf } from '../lib/csrf';
import { EmailService } from '../lib/email';
import { CLIENT_URL, PASSWORD_RESET_TOKEN_TTL_MS } from '../lib/env';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', loginLimiter, requireCsrf, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[login] rejected: invalid request body shape');
    return res.status(400).json({ error: 'Invalid email or password.' });
  }
  const { email, password } = parsed.data;
  const ip = req.ip;
  const userAgent = req.header('user-agent');

  if (await isBruteForced(email)) {
    console.warn('[login] rejected: rate-limited (too many failed attempts)', { email });
    return res.status(429).json({ error: 'Too many failed attempts. Please try again later.' });
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (!user || !user.active) {
    console.warn('[login] rejected: no matching active user', { email });
    await recordLoginAttempt(email, false, ip, userAgent);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    console.warn('[login] rejected: password mismatch', { email });
    await recordLoginAttempt(email, false, ip, userAgent);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  console.log('[login] success', { email, role: user.role });
  await recordLoginAttempt(email, true, ip, userAgent);
  await createSession(user.id, res);

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.post('/logout', requireCsrf, requireAuth, async (req, res) => {
  if (req.sessionToken) {
    await destroySession(req.sessionToken);
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.'),
});

// POST /api/auth/change-password
// Lets any authenticated user (Admin or Leader) change their own password,
// clearing mustChangePassword once done. Used both for the forced
// first-login change (Admin bootstrap, newly created Leaders) and for a
// voluntary password change at any later time.
router.post('/change-password', requireCsrf, requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'PASSWORD_CHANGED',
    targetType: 'User',
    targetId: user.id,
  });

  res.json({ ok: true });
});

const updateEmailSchema = z.object({
  currentPassword: z.string().min(1),
  newEmail: z.string().email(),
});

// POST /api/auth/update-email
// Lets any authenticated user (Admin or Leader) change their OWN login
// email — e.g. when the address on file (set at account creation) isn't
// one they can actually check, which otherwise silently locks them out of
// "forgot password" recovery. Requires the current password, same as
// change-password above, so a session left open on a shared device can't
// be used to redirect account recovery to an attacker's inbox.
router.post('/update-email', requireCsrf, requireAuth, async (req, res) => {
  const parsed = updateEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { currentPassword, newEmail } = parsed.data;
  const email = newEmail.toLowerCase();

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  if (email === user.email) {
    return res.status(400).json({ error: 'This is already your current email address.' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  const oldEmail = user.email;
  await prisma.user.update({ where: { id: user.id }, data: { email } });

  await recordAudit({
    actorId: user.id,
    actorEmail: email,
    action: 'ACCOUNT_EMAIL_CHANGED',
    targetType: 'User',
    targetId: user.id,
    metadata: { from: oldEmail, to: email },
  });

  res.json({ ok: true, email });
});

// ---------------------------------------------------------------------------
// New Leader onboarding (sections 27-30) — one-time emailed setup link.
// Existing mustChangePassword accounts are NOT touched by this; they keep
// using POST /api/auth/change-password above, unchanged.
// ---------------------------------------------------------------------------

const leaderSetupSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long.'),
});

router.post('/leader-setup/complete', leaderSetupLimiter, requireCsrf, async (req, res) => {
  const parsed = leaderSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const setupToken = await prisma.leaderSetupToken.findUnique({ where: { tokenHash } });
  if (!setupToken || setupToken.consumedAt || setupToken.expiresAt < new Date()) {
    return res.status(400).json({ error: 'This setup link is invalid or has expired. Please ask an Admin to resend your invitation.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const leader = await prisma.$transaction(async (tx) => {
    await tx.leaderSetupToken.update({ where: { id: setupToken.id }, data: { consumedAt: new Date() } });
    return tx.user.update({
      where: { id: setupToken.leaderId },
      data: { passwordHash, mustChangePassword: false },
    });
  });

  await recordAudit({
    actorId: leader.id,
    actorEmail: leader.email,
    action: 'LEADER_SETUP_COMPLETED',
    targetType: 'User',
    targetId: leader.id,
  });

  await createSession(leader.id, res);

  res.json({
    user: { id: leader.id, name: leader.name, email: leader.email, role: leader.role, mustChangePassword: false },
  });
});

// ---------------------------------------------------------------------------
// Password reset (section 33) — generic response regardless of whether the
// account exists, to prevent enumeration.
// ---------------------------------------------------------------------------

const GENERIC_RESET_RESPONSE = {
  message: 'If an account exists for that email, a password reset link has been sent.',
};

const forgotPasswordSchema = z.object({ email: z.string().email() });

router.post('/forgot-password', passwordResetRequestLimiter, requireCsrf, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    // Still generic — an invalid email shape reveals nothing either.
    return res.json(GENERIC_RESET_RESPONSE);
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user && user.active) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });

    const resetUrl = `${CLIENT_URL}/reset-password?token=${rawToken}`;
    await EmailService.sendPasswordReset({ to: user.email, resetUrl });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'User',
      targetId: user.id,
    });
  }

  // Same response, same shape, whether or not an account exists.
  res.json(GENERIC_RESET_RESPONSE);
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long.'),
});

router.post('/reset-password', passwordResetRedeemLimiter, requireCsrf, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || resetToken.consumedAt || resetToken.expiresAt < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const user = await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: resetToken.id }, data: { consumedAt: new Date() } });
    return tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, mustChangePassword: false },
    });
  });

  // Section 33: invalidate every existing session for the account.
  await destroyAllSessionsForUser(user.id);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'PASSWORD_RESET_COMPLETED',
    targetType: 'User',
    targetId: user.id,
  });

  res.json({ ok: true });
});

export default router;
