import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
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
import publicSettingsRoutes from './routes/publicSettings';

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
  app.use('/api/settings', publicSettingsRoutes);

  // 404 for unmatched API routes
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // In production, this same service also serves the built React client
  // (client/dist), so the frontend and API share one origin — cookies
  // (visitor_id, sid, csrf_token) stay same-site with no changes to their
  // SameSite/Secure flags. This is optional: it only activates if a build
  // of the client is actually present next to this server's own build.
  if (isProd) {
    const clientDist = path.join(__dirname, '../../client/dist');
    if (fs.existsSync(clientDist)) {
      app.use(
        express.static(clientDist, {
          setHeaders: (res, filePath) => {
            // Set these explicitly rather than trusting MIME-sniffing —
            // Chrome's PWA installability check and the service worker
            // registration both depend on getting the right Content-Type.
            if (filePath.endsWith('manifest.webmanifest')) {
              res.setHeader('Content-Type', 'application/manifest+json');
            } else if (filePath.endsWith('sw.js')) {
              // Never let the service worker script itself be cached by the
              // browser/CDN — a stale sw.js means updates (like this fix)
              // never reach a device that already installed the app.
              res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
              res.setHeader('Cache-Control', 'no-cache');
            }
          },
        }),
      );
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }

  // Centralized error handler — never leak stack traces to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled error]', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  });

  return app;
}
