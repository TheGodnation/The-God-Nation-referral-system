import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { isProd } from './env';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Issues a readable (non-httpOnly) CSRF token cookie for every visitor if
 * one is not already present. The client reads this cookie and echoes it
 * back in the X-CSRF-Token header on state-changing requests (double-submit
 * cookie pattern).
 */
export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  if (!token || typeof token !== 'string') {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
    });
  }
  next();
}

/**
 * Enforces the double-submit CSRF check on state-changing requests.
 * Mandatory across the application — never optional.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.header(CSRF_HEADER_NAME);

  if (
    !cookieToken ||
    !headerToken ||
    typeof headerToken !== 'string' ||
    cookieToken !== headerToken
  ) {
    // Diagnostic only — never logs token values, just presence/mismatch,
    // so a rejected login/action can be told apart from a bad password.
    console.warn('[csrf] rejected', {
      method: req.method,
      path: req.path,
      hasCookie: Boolean(cookieToken),
      hasHeader: Boolean(headerToken),
      match: Boolean(cookieToken) && Boolean(headerToken) && cookieToken === headerToken,
    });
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  next();
}
