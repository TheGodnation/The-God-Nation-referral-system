export const isProd = process.env.NODE_ENV === 'production';

export const PORT = parseInt(process.env.PORT || '4000', 10);
export const APP_URL = process.env.APP_URL || 'http://localhost:4000';
export const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

export const VISITOR_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // ~1 year
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
