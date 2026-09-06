import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { CLIENT_URL, isProd } from './lib/env';
import { ensureVisitorId } from './lib/visitor';
import { ensureCsrfCookie } from './lib/csrf';
import { loadSession } from './lib/auth';
import { generalApiLimiter } from './lib/rateLimit';

import authRoutes from './routes/auth';
import referralRoutes from './routes/referrals';
import registrationRoutes from './routes/registrations';
import leaderRoutes from './routes/leader';
import adminRoutes from './routes/admin';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: CLIENT_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(ensureVisitorId);
  app.use(ensureCsrfCookie);
  app.use(loadSession);
  app.use('/api', generalApiLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/registrations', registrationRoutes);
  app.use('/api/leader', leaderRoutes);
  app.use('/api/admin', adminRoutes);

  // 404 for unmatched API routes
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Centralized error handler — never leak stack traces to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled error]', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  });

  return app;
}
