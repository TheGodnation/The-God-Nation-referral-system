import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { isProd, VISITOR_COOKIE_MAX_AGE_MS } from './env';

export const VISITOR_COOKIE_NAME = 'visitor_id';

declare global {
  namespace Express {
    interface Request {
      visitorId?: string;
    }
  }
}

function generateVisitorId(): string {
  // Cryptographically random, opaque identifier. Contains no attribution data.
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensures every request carries an opaque, long-lived visitor_id cookie.
 * The cookie is httpOnly, Secure in production, SameSite=Lax, and contains
 * ONLY the opaque identifier — never a referral code, Leader ID, or any
 * other attribution data.
 */
export function ensureVisitorId(req: Request, res: Response, next: NextFunction) {
  let visitorId = req.cookies?.[VISITOR_COOKIE_NAME];

  if (!visitorId || typeof visitorId !== 'string' || !/^[a-f0-9]{64}$/.test(visitorId)) {
    visitorId = generateVisitorId();
    res.cookie(VISITOR_COOKIE_NAME, visitorId, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: VISITOR_COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }

  req.visitorId = visitorId;
  next();
}
