import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { hashToken } from './auth';
import { isProd, MEMBER_SESSION_MAX_AGE_MS } from './env';
import type { Language } from '@prisma/client';

// Phase 3C: a session mechanism completely separate from the existing
// Admin/Leader `Session`/`sid` cookie — different cookie name, different
// table, different middleware, different request property (`req.member`,
// never `req.user`). There is no code path by which a MemberSession can
// ever populate `req.user` or vice versa, so a member session can never
// satisfy `requireAuth`/`requireRole` on the existing Admin/Leader routes
// (see the explicit regression tests in memberSessionIsolation.test.ts).
export const MEMBER_SESSION_COOKIE_NAME = 'msid';

declare global {
  namespace Express {
    interface Request {
      member?: { memberAccountId: string; personId: string; name: string; email: string; preferredLanguage: Language };
      memberSessionToken?: string;
    }
  }
}

export function generateMemberSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createMemberSession(memberAccountId: string, res: Response) {
  const token = generateMemberSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MEMBER_SESSION_MAX_AGE_MS);

  await prisma.memberSession.create({ data: { memberAccountId, tokenHash, expiresAt } });

  res.cookie(MEMBER_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: MEMBER_SESSION_MAX_AGE_MS,
    path: '/',
  });

  return token;
}

export async function destroyMemberSession(token: string) {
  const tokenHash = hashToken(token);
  await prisma.memberSession.deleteMany({ where: { tokenHash } });
}

/**
 * Loads the current member session (if any) and attaches req.member. Never
 * touches req.user. Safe to run globally, mirroring loadSession.
 */
export async function loadMemberSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[MEMBER_SESSION_COOKIE_NAME];
    if (!token || typeof token !== 'string') return next();

    const tokenHash = hashToken(token);
    const session = await prisma.memberSession.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt < new Date()) return next();

    const account = await prisma.memberAccount.findUnique({
      where: { id: session.memberAccountId },
      include: { person: true },
    });
    if (!account) return next();

    req.member = {
      memberAccountId: account.id,
      personId: account.personId,
      name: account.person.name,
      email: account.email,
      preferredLanguage: account.person.preferredLanguage,
    };
    req.memberSessionToken = token;

    prisma.memberSession
      .update({ where: { id: session.id }, data: { lastActivityAt: new Date() } })
      .catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

export function requireMember(req: Request, res: Response, next: NextFunction) {
  if (!req.member) {
    console.warn('[member-auth] rejected: no member session', {
      path: req.path,
      hasMsidCookie: Boolean(req.cookies?.[MEMBER_SESSION_COOKIE_NAME]),
    });
    return res.status(401).json({ error: 'Member authentication required.' });
  }
  next();
}
