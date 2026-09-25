import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { CLIENT_URL, GUIDE_HOST, isProd } from './lib/env';
import { ensureVisitorId } from './lib/visitor';
import { ensureCsrfCookie } from './lib/csrf';
import { loadSession } from './lib/auth';
import { loadMemberSession } from './lib/memberAuth';
import { generalApiLimiter } from './lib/rateLimit';

import authRoutes from './routes/auth';
import referralRoutes from './routes/referrals';
import registrationRoutes from './routes/registrations';
import leaderRoutes from './routes/leader';
import adminRoutes from './routes/admin';
import publicSettingsRoutes from './routes/publicSettings';
import contentPagesRoutes from './routes/contentPages';
import contactRoutes from './routes/contact';
import adminPeopleRoutes from './routes/adminPeople';
import adminGeographyRoutes from './routes/adminGeography';
import adminCommunitiesRoutes from './routes/adminCommunities';
import adminDevotionalsRoutes from './routes/adminDevotionals';
import adminAssessmentsRoutes from './routes/adminAssessments';
import adminAttemptsRoutes from './routes/adminAttempts';
import memberAuthRoutes from './routes/memberAuth';
import memberAssessmentsRoutes from './routes/memberAssessments';
import adminLeadershipRoutes from './routes/adminLeadership';
import leaderFollowUpsRoutes from './routes/leaderFollowUps';
import leaderLeadershipProposalsRoutes from './routes/leaderLeadershipProposals';
import adminLeadershipProposalsRoutes from './routes/adminLeadershipProposals';
import communityConversationsRoutes from './routes/communityConversations';
import followUpConversationsRoutes from './routes/followUpConversations';
import announcementsRoutes from './routes/announcements';
import adminAnnouncementsRoutes from './routes/adminAnnouncements';
import geographyConversationsRoutes from './routes/geographyConversations';
import { prisma } from './lib/prisma';
import { APP_URL } from './lib/env';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  // Gzip/brotli-compress every text response (HTML, CSS, JS, JSON). This
  // matters most for visitors on slow connections (2G/3G, common among our
  // leaders) — it typically shrinks the JS bundle and API responses by
  // 60-70% with no code changes needed anywhere else.
  app.use(compression());
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
  // Phase 3C: a completely separate session lookup, reading a different
  // cookie (msid) into a different request property (req.member) — never
  // req.user. requireAuth/requireRole below only ever check req.user, so a
  // member session can never satisfy them (see memberSessionIsolation.test.ts).
  app.use(loadMemberSession);
  app.use('/api', generalApiLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/registrations', registrationRoutes);
  app.use('/api/leader', leaderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/settings', publicSettingsRoutes);
  app.use('/api/content-pages', contentPagesRoutes);
  app.use('/api/contact', contactRoutes);
  // Phase 3A: adminPeopleRoutes defines its own '/people' and
  // '/community-memberships' sub-paths, so it mounts at the '/api/admin'
  // root rather than a specific sub-path — matching adminRoutes above.
  app.use('/api/admin', adminPeopleRoutes);
  app.use('/api/admin/geography', adminGeographyRoutes);
  app.use('/api/admin/communities', adminCommunitiesRoutes);
  app.use('/api/admin/devotionals', adminDevotionalsRoutes);
  app.use('/api/admin/assessments', adminAssessmentsRoutes);
  // Phase 3B: adminAttemptsRoutes defines '/people/:personId/attempts' and
  // '/attempts/*', so it mounts at the '/api/admin' root, same pattern as
  // adminPeopleRoutes above.
  app.use('/api/admin', adminAttemptsRoutes);
  app.use('/api/member/auth', memberAuthRoutes);
  app.use('/api/member', memberAssessmentsRoutes);
  // Phase 3D: adminLeadershipRoutes defines '/role-assignments' and
  // '/follow-ups', so it mounts at the '/api/admin' root, same pattern as
  // adminPeopleRoutes/adminAttemptsRoutes above.
  app.use('/api/admin', adminLeadershipRoutes);
  app.use('/api/leader', leaderFollowUpsRoutes);
  // Phase 3L: leaderLeadershipProposalsRoutes defines '/leadership-proposals'
  // under '/api/leader'; adminLeadershipProposalsRoutes defines the same
  // path under '/api/admin' — same root-mount pattern as the routes above.
  app.use('/api/leader', leaderLeadershipProposalsRoutes);
  app.use('/api/admin', adminLeadershipProposalsRoutes);
  // Phase 3M.1: one shared resource family for a Community's conversation,
  // reachable by an authenticated Member or Leader — authorization branches
  // internally (see communityConversations.ts) rather than duplicating
  // routes per role.
  app.use('/api/communities', communityConversationsRoutes);
  // Phase 3M.2: one shared resource family for a FollowUpAssignment's
  // conversation, reachable by its follower (Leader) or followed Person
  // (Member, only if they have a MemberAccount) — structurally separate
  // from communityConversationsRoutes above (own models, own tables, own
  // authorization helper in lib/followUpConversation.ts).
  app.use('/api/follow-ups', followUpConversationsRoutes);
  // Phase 3M.3: shared authenticated recipient surface for Central Authority
  // targeted announcements (Member or Leader, never Admin — see
  // announcements.ts), plus the separate Admin management surface.
  app.use('/api/me/announcements', announcementsRoutes);
  app.use('/api/admin/announcements', adminAnnouncementsRoutes);
  // Phase 3M.6: one shared resource family for a Geography's two-way group
  // conversation, reachable by an authenticated Member or Leader whose
  // current GeographicAssignment or exact-match Geography RoleAssignment
  // authorizes it (see lib/geographyConversation.ts) — a structural sibling
  // of communityConversationsRoutes above, never a shared/generic engine
  // with it.
  app.use('/api/geographies', geographyConversationsRoutes);

  // Phase 2: lists only published ContentPage slugs, so unpublished (draft)
  // content is never surfaced to a crawler as an indexable URL.
  app.get('/sitemap.xml', async (_req, res, next) => {
    try {
      const pages = await prisma.contentPage.findMany({
        where: { published: true },
        select: { slug: true, updatedAt: true },
      });
      const staticUrls = ['', '/join'];
      const urls = [
        ...staticUrls.map((p) => `${APP_URL}${p}`),
        ...pages.map((p) => `${APP_URL}/page/${p.slug}`),
      ];
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${u}</loc></url>`)
        .join('\n')}\n</urlset>`;
      res.set('Content-Type', 'application/xml');
      res.send(body);
    } catch (err) {
      next(err);
    }
  });

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
      // If a guide subdomain is configured (GUIDE_HOST), its root request
      // serves the Leader Quick-Start Guide directly — a short, brandable
      // link — rather than the main app's homepage. The guide's own
      // assets are still served normally under /leader-guide/... below
      // (its <img> tags use that absolute path), and every other host
      // (the main domain) is completely unaffected.
      if (GUIDE_HOST) {
        app.get('/', (req, res, next) => {
          if (req.hostname === GUIDE_HOST) {
            return res.sendFile(path.join(clientDist, 'leader-guide', 'index.html'));
          }
          next();
        });
      }
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
            } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              // Vite names every file in here with a content hash (e.g.
              // index-BpGroIUE.js) — a new build always gets new filenames,
              // so it's safe to tell browsers to cache these forever and
              // skip the network entirely on repeat visits. This matters a
              // lot on slow connections (2G/3G): without it, every visit
              // re-fetches the JS/CSS bundle (or at least round-trips to
              // revalidate it), which is the single biggest thing a repeat
              // visitor downloads.
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
