export const isProd = process.env.NODE_ENV === 'production';

export const PORT = parseInt(process.env.PORT || '4000', 10);
export const APP_URL = process.env.APP_URL || 'http://localhost:4000';
export const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Optional: a subdomain (e.g. "guide.thegodnationacademy.org") that, once
// DNS points it at this same service, serves the Leader Quick-Start Guide
// directly at its root — a short, brandable link to hand out, instead of
// only being reachable at /leader-guide on the main domain. Unset by
// default; setting this env var is the only step needed on this side once
// the domain is added in Render and pointed here in DNS.
export const GUIDE_HOST = process.env.GUIDE_HOST || '';

export const VISITOR_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // ~1 year
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const LEADER_SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const MEMBER_LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MEMBER_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
