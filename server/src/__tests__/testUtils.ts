import request from 'supertest';
import type { Express } from 'express';

function findCookie(res: any, name: string): string | undefined {
  const setCookies: string[] = res.headers['set-cookie'] || [];
  for (const c of setCookies) {
    const match = c.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}

/** Performs the bootstrap GET request through the given agent (its first
 * request) and returns both the CSRF token and opaque visitor_id cookie
 * values that get minted on it — both are only sent via Set-Cookie on the
 * very first request from a fresh agent, since ensureVisitorId/ensureCsrfCookie
 * only issue them when missing. */
export async function bootstrap(agent: ReturnType<typeof request.agent>): Promise<{
  csrf: string;
  visitorId: string;
}> {
  const res = await agent.get('/api/auth/me');
  const csrf = findCookie(res, 'csrf_token');
  const visitorId = findCookie(res, 'visitor_id');
  if (!csrf) throw new Error('CSRF token cookie not found in response');
  if (!visitorId) throw new Error('visitor_id cookie not found in response');
  return { csrf, visitorId };
}

/** Back-compat helper returning just the CSRF token. */
export async function getCsrfToken(agent: ReturnType<typeof request.agent>): Promise<string> {
  const { csrf } = await bootstrap(agent);
  return csrf;
}

export function agentFor(app: Express) {
  return request.agent(app);
}
