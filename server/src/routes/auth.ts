import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { createSession, destroySession, requireAuth, SESSION_COOKIE_NAME } from '../lib/auth';
import { isBruteForced, recordLoginAttempt, recordAudit } from '../lib/audit';
import { loginLimiter } from '../lib/rateLimit';
import { requireCsrf } from '../lib/csrf';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', loginLimiter, requireCsrf, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }
  const { email, password } = parsed.data;
  const ip = req.ip;
  const userAgent = req.header('user-agent');

  if (await isBruteForced(email)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please try again later.' });
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (!user || !user.active) {
    await recordLoginAttempt(email, false, ip, userAgent);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordLoginAttempt(email, false, ip, userAgent);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

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

export default router;
