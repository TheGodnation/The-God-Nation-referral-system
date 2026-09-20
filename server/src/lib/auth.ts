import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { isProd, SESSION_MAX_AGE_MS } from './env';
import type { Role } from '@prisma/client';

export const SESSION_COOKIE_NAME = 'sid';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; name: string; email: string; role: Role; mustChangePassword: boolean };
      sessionToken?: string;
    }
  }
}

// Shared secure-token hashing pattern, reused by LeaderSetupToken and
// PasswordResetToken (sections 28/33) — never store or log the raw token,
// only this hash.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: string, res: Response) {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });

  return token;
}

export async function destroySession(token: string) {
  const tokenHash = hashToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

// Used after a successful password reset (section 33): invalidate every
// existing session for the account, not just the one making the request.
export async function destroyAllSessionsForUser(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * Loads the current session (if any) and attaches req.user. Does not reject
 * unauthenticated requests — use requireAuth for that. Safe to run globally.
 */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token || typeof token !== 'string') return next();

    const tokenHash = hashToken(token);
    const session = await prisma.session.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt < new Date()) return next();

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.active) return next();

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
    req.sessionToken = token;

    // Best-effort activity tracking; ignore failures.
    prisma.session
      .update({ where: { id: session.id }, data: { lastActivityAt: new Date() } })
      .catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    // Diagnostic only — no secrets, just whether a session cookie showed up
    // at all, to tell "never logged in" apart from "cookie not persisting".
    console.warn('[auth] rejected: no session', {
      path: req.path,
      hasSidCookie: Boolean(req.cookies?.[SESSION_COOKIE_NAME]),
    });
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      console.warn('[auth] rejected: no session', {
        path: req.path,
        hasSidCookie: Boolean(req.cookies?.[SESSION_COOKIE_NAME]),
      });
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      console.warn('[auth] rejected: wrong role', { path: req.path, role: req.user.role });
      return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
  };
}
