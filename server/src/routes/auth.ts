import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { createSession, destroySession, requireAuth, SESSION_COOKIE_NAME } from '../lib/auth';
import { isBruteForced, recordLoginAttempt } from '../lib/audit';
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

export default router;
