import { memberRouter as accountDeletionMemberRoutes, publicRouter as accountDeletionPublicRoutes, adminRouter as accountDeletionAdminRoutes } from './routes/accountDeletion';
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
import { loadSession, dropMismatchedLeaderSession } from './lib/auth';
import { loadMemberSession } from './lib/memberAuth';
import { generalApiLimiter } from './lib/rateLimit';

import authRoutes from './routes/auth';
import referralRoutes from './routes/referrals';
import leadsRoutes from './routes/leads';
import unsubscribeRoutes from './routes/unsubscribe';
import { adminRemindersRoutes, memberCentralRemindersRoutes } from './routes/adminReminders';
import { adminAdsRoutes, memberCentralAdsRoutes } from './routes/adminAds';
import { adminKnowledgeRoutes, memberCentralKnowledgeRoutes } from './routes/adminKnowledge';
import { publicSiteRouter } from './lib/publicSite/router';
import { spaHandler } from './lib/ogMeta';
import { adminGrowthRoutes, memberCentralGrowthRoutes } from './routes/adminGrowth';
import memberContactConsentRoutes from './routes/memberContactConsent';
import leaderRoutes from './routes/leader';
import adminRoutes from './routes/admin';
import adminMemberBridgeRoutes from './routes/adminMemberBridge';
import publicSettingsRoutes from './routes/publicSettings';
import contentPagesRoutes from './routes/contentPages';
import contactRoutes from './routes/contact';
import adminPeopleRoutes from './routes/adminPeople';
import adminSignInTroubleRoutes from './routes/adminSignInTrouble';
import teachingsRoutes from './routes/teachings';
import communityManageRoutes from './routes/communityManage';
import adminCommunitiesRoutes, { memberCentralCommunitiesRoutes } from './routes/adminCommunities';
import adminDevotionalsRoutes from './routes/adminDevotionals';
import adminAssessmentsRoutes from './routes/adminAssessments';
import adminResultsRoutes from './routes/adminResults';
import clientErrorsRoutes from './routes/clientErrors';
import adminAttemptsRoutes from './routes/adminAttempts';
import memberAuthRoutes from './routes/memberAuth';
import memberAssessmentsRoutes from './routes/memberAssessments';
import memberGivingRoutes from './routes/memberGiving';
import { adminGivingRoutes, memberCentralGivingRoutes } from './routes/adminGiving';
import { adminLeaderReferralReportRoutes, memberCentralLeaderReferralReportRoutes } from './routes/adminLeaderReferralReport';
import { adminTeachingCompletionRoutes, memberCentralTeachingCompletionRoutes } from './routes/adminTeachingCompletion';
import { adminLeaderRoomsRoutes, memberCentralLeaderRoomsRoutes } from './routes/adminLeaderRooms';
import { memberRepCellsRoutes } from './routes/repCells';
import { memberCentralGroupsRoutes, memberRepGroupsRoutes } from './routes/groupLeaders';
import { adminBroadcastLogRoutes, memberBroadcastRoutes, memberCentralBroadcastLogRoutes, memberRepBroadcastLogRoutes } from './routes/broadcast';
import { adminFaithRoutes, memberFaithRoutes } from './routes/faith';
import { adminWeeklyReportsRoutes, memberCentralWeeklyReportsRoutes, memberRepWeeklyReportsRoutes, memberWeeklyReportRoutes } from './routes/weeklyReports';
import { adminRepresentativesRoutes, memberCentralRepresentativesRoutes, memberRepresentativeRoutes } from './routes/representatives';
import { adminSanctionsRoutes, memberSanctionsRoutes } from './routes/sanctions';
import { adminBulkMembersRoutes, memberCentralBulkMembersRoutes } from './routes/adminBulkMembers';
import { adminInstructionsRoutes, memberCentralInstructionsRoutes, memberInstructionsRoutes, memberRepresentativeInstructionsRoutes } from './routes/adminInstructions';
import memberClinicRoutes from './routes/memberClinic';
import leaderClinicRoutes from './routes/leaderClinic';
import leaderEscalationsRoutes from './routes/leaderEscalations';
import { adminCellsRoutes, memberCentralCellsRoutes } from './routes/adminCells';
import { adminTokensRoutes, memberCentralTokensRoutes } from './routes/adminTokens';
import memberTokensRoutes from './routes/memberTokens';
import adminLeadershipRoutes from './routes/adminLeadership';
import leaderFollowUpsRoutes from './routes/leaderFollowUps';
import leaderCommunitiesRoutes from './routes/leaderCommunities';
import communityConversationsRoutes from './routes/communityConversations';
import followUpConversationsRoutes from './routes/followUpConversations';
import announcementsRoutes from './routes/announcements';
import adminAnnouncementsRoutes from './routes/adminAnnouncements';
import adminConversationOversightRoutes from './routes/adminConversationOversight';
import leaderLeadershipCollaborationRoutes from './routes/leaderLeadershipCollaboration';
import adminLocationsRoutes from './routes/adminLocations';
import adminPresenceRoutes from './routes/adminPresence';
import appBrandingRoutes from './routes/appBranding';
import chatForwardRoutes from './routes/chatForward';
import headquartersPostsRoutes from './routes/headquartersPosts';
import adminHeadquartersPostsRoutes from './routes/adminHeadquartersPosts';
import privateMessagesRoutes from './routes/privateMessages';
import adminPrivateMessagesRoutes from './routes/adminPrivateMessages';
import leaderPrivateMessagesRoutes from './routes/leaderPrivateMessages';
import resourcesRoutes from './routes/resources';
import adminResourcesRoutes from './routes/adminResources';
import adminResourceAccessRoutes from './routes/adminResourceAccess';
import notificationsRoutes from './routes/notifications';
import profilePhotosRoutes from './routes/profilePhotos';
import updatesRoutes from './routes/updates';
import shareIntoAppRoutes from './routes/shareIntoApp';
import prayerRequestsRoutes from './routes/prayerRequests';
import socialRoutes from './routes/social';
import { adminMemberReportsRouter, leaderMemberReportsRouter } from './routes/memberReports';
import areaRepresentationRequestsRoutes from './routes/areaRepresentationRequests';
import adminAreaRepresentationRequestsRoutes from './routes/adminAreaRepresentationRequests';
import adminGeographicAreasRoutes from './routes/adminGeographicAreas';
import memberEarningsRoutes from './routes/memberEarnings';
import adminPayoutsRoutes from './routes/adminPayouts';
import paymentOrdersRoutes from './routes/paymentOrders';
import eventsRoutes from './routes/events';
import adminPaymentAgentsRoutes from './routes/adminPaymentAgents';
import memberReferralsRoutes from './routes/memberReferrals';
import examWorldRoutes from './routes/examWorld';
import paymentRoutes from './routes/payments';
import adminLibraryRoutes from './routes/adminLibrary';
import leaderExamResultsRoutes from './routes/leaderExamResults';
import leaderResultsRoutes from './routes/leaderResults';
import { prisma } from './lib/prisma';
import { markActivity } from './lib/activity';
import { APP_URL } from './lib/env';
import { assetLinksHandler } from './lib/assetLinks';

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
  // Proof for Google Play that the Android app and this website belong together (see lib/assetLinks.ts).
  app.get('/.well-known/assetlinks.json', assetLinksHandler);
  // The public website (/en/…, /fr/…): complete HTML pages, no cookies. Off unless
  // PUBLIC_SITE_ENABLED=true. Placed before the cookie, session and API steps on purpose.
  if (process.env.PUBLIC_SITE_ENABLED === 'true') app.use(publicSiteRouter());
  // 1mb: a 65,536-character chat message (WhatsApp's own limit, now matched
  // by communityConversations.ts/privateMessages.ts) can be a few hundred KB
  // once multi-byte UTF-8 (accented French text, emoji) is accounted for.
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(ensureVisitorId);
  app.use(ensureCsrfCookie);
  app.use(loadSession);
  // Phase 3C: a completely separate session lookup, reading a different
  // cookie (msid) into a different request property (req.member) — never
  // req.user. requireAuth/requireRole below only ever check req.user, so a
  // member session can never satisfy them (see memberSessionIsolation.test.ts).
  app.use(loadMemberSession);
  app.use(dropMismatchedLeaderSession);
  app.use('/api', generalApiLimiter);
  app.use('/api', (req, _res, next) => {
    if (req.path !== '/health') markActivity();
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/leads', leadsRoutes);
  app.use('/api/unsubscribe', unsubscribeRoutes);
  app.use('/api/leader', leaderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/admin', adminMemberBridgeRoutes);
  app.use('/api/settings', publicSettingsRoutes);
  app.use('/api/client-errors', clientErrorsRoutes);
  app.use('/api/content-pages', contentPagesRoutes);
  app.use('/api/contact', contactRoutes);
  // Phase 3A: adminPeopleRoutes defines its own '/people' and
  // '/community-memberships' sub-paths, so it mounts at the '/api/admin'
  // root rather than a specific sub-path — matching adminRoutes above.
  app.use('/api/admin', adminPeopleRoutes);
  app.use('/api/admin/presence', adminPresenceRoutes);
  app.use('/api/admin/communities', adminCommunitiesRoutes);
  app.use('/api/member/central-communities', memberCentralCommunitiesRoutes);
  app.use('/api/admin/devotionals', adminDevotionalsRoutes);
  app.use('/api/admin/assessments', adminAssessmentsRoutes);
  app.use('/api/admin/results', adminResultsRoutes);
  // Phase 3B: adminAttemptsRoutes defines '/people/:personId/attempts' and
  // '/attempts/*', so it mounts at the '/api/admin' root, same pattern as
  // adminPeopleRoutes above.
  app.use('/api/admin', adminAttemptsRoutes);
  app.use('/api/member/auth', memberAuthRoutes);
  app.use('/api/member/account', accountDeletionMemberRoutes);
  app.use('/api/account-deletion', accountDeletionPublicRoutes);
  app.use('/api/admin/account-deletions', accountDeletionAdminRoutes);
  app.use('/api/admin/sign-in-trouble', adminSignInTroubleRoutes);
  app.use('/api/teachings', teachingsRoutes);
  app.use('/api/member', memberAssessmentsRoutes);
  // Phase 3D: adminLeadershipRoutes defines '/role-assignments' and
  // '/follow-ups', so it mounts at the '/api/admin' root, same pattern as
  // adminPeopleRoutes/adminAttemptsRoutes above.
  app.use('/api/member/giving', memberGivingRoutes);
  app.use('/api/member/central-giving', memberCentralGivingRoutes);
  app.use('/api/admin/giving', adminGivingRoutes);
  app.use('/api/admin/instructions', adminInstructionsRoutes);
  app.use('/api/admin/bulk-members', adminBulkMembersRoutes);
  app.use('/api/admin/sanctions', adminSanctionsRoutes);
  app.use('/api/admin/representatives', adminRepresentativesRoutes);
  app.use('/api/admin/weekly-reports', adminWeeklyReportsRoutes);
  app.use('/api/admin/faith', adminFaithRoutes);
  app.use('/api/admin/broadcast-log', adminBroadcastLogRoutes);
  app.use('/api/admin/leader-rooms', adminLeaderRoomsRoutes);
  app.use('/api/admin/teaching-completion', adminTeachingCompletionRoutes);
  app.use('/api/admin/leader-referral-report', adminLeaderReferralReportRoutes);
  app.use('/api/member/central-leader-referral-report', memberCentralLeaderReferralReportRoutes);
  app.use('/api/member/central-teaching-completion', memberCentralTeachingCompletionRoutes);
  app.use('/api/member/central-leader-rooms', memberCentralLeaderRoomsRoutes);
  app.use('/api/member/central-instructions', memberCentralInstructionsRoutes);
  app.use('/api/member/central-bulk-members', memberCentralBulkMembersRoutes);
  app.use('/api/member/sanctions', memberSanctionsRoutes);
  app.use('/api/member/central-representatives', memberCentralRepresentativesRoutes);
  app.use('/api/member/representative', memberRepresentativeRoutes);
  app.use('/api/member/rep-instructions', memberRepresentativeInstructionsRoutes);
  app.use('/api/member/rep-cells', memberRepCellsRoutes);
  app.use('/api/member/central-groups', memberCentralGroupsRoutes);
  app.use('/api/member/rep-groups', memberRepGroupsRoutes);
  app.use('/api/member/weekly-report', memberWeeklyReportRoutes);
  app.use('/api/member/broadcast', memberBroadcastRoutes);
  app.use('/api/member/central-broadcast-log', memberCentralBroadcastLogRoutes);
  app.use('/api/member/rep-broadcast-log', memberRepBroadcastLogRoutes);
  app.use('/api/member/central-weekly-reports', memberCentralWeeklyReportsRoutes);
  app.use('/api/member/faith', memberFaithRoutes);
  app.use('/api/member/rep-weekly-reports', memberRepWeeklyReportsRoutes);
  app.use('/api/member/instructions', memberInstructionsRoutes);
  app.use('/api/member/clinic', memberClinicRoutes);
  app.use('/api/leader', leaderClinicRoutes);
  app.use('/api/leader', leaderEscalationsRoutes);
  app.use('/api/admin/cells', adminCellsRoutes);
  app.use('/api/member/central-cells', memberCentralCellsRoutes);
  app.use('/api/admin/tokens', adminTokensRoutes);
  app.use('/api/admin/growth', adminGrowthRoutes);
  app.use('/api/admin/reminders', adminRemindersRoutes);
  app.use('/api/admin/ads', adminAdsRoutes);
  app.use('/api/admin/knowledge', adminKnowledgeRoutes);
  app.use('/api/member/central-tokens', memberCentralTokensRoutes);
  app.use('/api/member/central-growth', memberCentralGrowthRoutes);
  app.use('/api/member/central-reminders', memberCentralRemindersRoutes);
  app.use('/api/member/central-ads', memberCentralAdsRoutes);
  app.use('/api/member/central-knowledge', memberCentralKnowledgeRoutes);
  app.use('/api/member/tokens', memberTokensRoutes);
  app.use('/api/member', memberContactConsentRoutes);
  app.use('/api/admin', adminLeadershipRoutes);
  app.use('/api/leader', leaderFollowUpsRoutes);
  // Phase 3M.8A: leaderCommunitiesRoutes defines '/communities/:communityId/members',
  // the Community Administrator's own membership-management surface — kept
  // separate from adminPeople.ts's Admin-only membership routes, same
  // per-concern file split as every other leader*/admin* pair in this app.
  app.use('/api/leader', leaderCommunitiesRoutes);
  // Phase 3M.1: one shared resource family for a Community's conversation,
  // reachable by an authenticated Member or Leader — authorization branches
  // internally (see communityConversations.ts) rather than duplicating
  // routes per role.
  app.use('/api/communities', communityConversationsRoutes);
  app.use('/api/communities', communityManageRoutes);
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
  // Phase 3M.8B: Central Authority (Admin) read-only conversation oversight
  // — defines '/communities/:communityId/conversation/messages' and
  // '/follow-ups/:followUpAssignmentId/conversation/messages', so it mounts
  // at the '/api/admin' root, same multi-file-sharing-one-prefix pattern as
  // adminPeopleRoutes/adminAttemptsRoutes/adminLeadershipRoutes above. Fully
  // independent of communityConversationsRoutes/followUpConversationsRoutes
  // — no shared middleware, no shared route.
  app.use('/api/admin', adminConversationOversightRoutes);
  // Phase 2B: leaderLeadershipCollaborationRoutes defines
  // '/leadership-collaboration' and its sub-routes under '/api/leader',
  // Leader-only — same per-concern file split and root-mount pattern as
  // leaderFollowUpsRoutes/leaderCommunitiesRoutes above. Fully independent of
  // communityConversationsRoutes/followUpConversationsRoutes — own models,
  // own tables, own authorization helper (lib/leadershipCollaboration.ts).
  app.use('/api/leader', leaderLeadershipCollaborationRoutes);
  // Member Location & Central Authority Location Intelligence:
  // adminLocationsRoutes defines '/locations' under '/api/admin' — same
  // root-mount pattern as adminPeopleRoutes/adminAttemptsRoutes above.
  // Read-only aggregation only; never creates/modifies a Community,
  // RoleAssignment, or CommunityMembership.
  app.use('/api/admin', adminLocationsRoutes);
  // Headquarters Network Posts & Shared Engagement: shared authenticated
  // recipient surface (Member or Leader, never Admin — same exclusion as
  // announcementsRoutes above), plus the separate Admin-only management
  // surface. Fully independent of Announcement's own routes/model — own
  // model family, own tables, own authorization helper
  // (lib/headquartersPosts.ts).
  app.use('/api/me/headquarters-posts', headquartersPostsRoutes);
  app.use('/api/admin/headquarters-posts', adminHeadquartersPostsRoutes);
  // Private Communication / Messaging: privateMessagesRoutes is the shared
  // authenticated participant surface (Member, Leader, or Admin — the one
  // conversation surface in this app where Admin genuinely participates,
  // see lib/privateMessaging.ts). adminPrivateMessagesRoutes/
  // leaderPrivateMessagesRoutes are separate, creation-only surfaces —
  // participant creation is never exposed through the shared route.
  app.use('/api/private-messages', privateMessagesRoutes);
  app.use('/api/admin/private-messages', adminPrivateMessagesRoutes);
  app.use('/api/leader/private-messages', leaderPrivateMessagesRoutes);
  // Book / Resource Access Grants: resourcesRoutes is the shared
  // authenticated Member/Leader recipient surface (Admin excluded — Admin
  // manages the catalog/grants below, it never "receives" a resource
  // through this route, same exclusion as announcements.ts/
  // headquartersPosts.ts). adminResourcesRoutes owns the Resource catalog;
  // adminResourceAccessRoutes owns granting/revoking one Person's access
  // and mounts at the '/api/admin' root (same multi-file-sharing-one
  // -prefix pattern as adminPeopleRoutes/adminLeadershipRoutes) so its
  // '/people/:personId/resource-access' routes read as an extension of the
  // existing People management surface.
  app.use('/api/me/resources', resourcesRoutes);
  app.use('/api/admin/resources', adminResourcesRoutes);
  app.use('/api/admin', adminResourceAccessRoutes);
  // In-App Notifications Foundation: notificationsRoutes is a shared
  // authenticated surface (Member, Leader, or Admin — reuses
  // lib/privateMessaging.ts's own identity resolver, same reasoning as
  // privateMessagesRoutes above for why Admin is included here too).
  app.use('/api/notifications', notificationsRoutes);
  // Profile pictures: member upload + signed-in viewing (/api/member/me/photo*, /api/people/:id/photo).
  app.use('/api', profilePhotosRoutes);
  app.use('/api', appBrandingRoutes);
  // Forward a chat message to other groups / private chats.
  app.use('/api/chat', chatForwardRoutes);
  // Community-wide Updates feed (posts, photos, comments, reactions, live slot).
  app.use('/api/updates', updatesRoutes);
  // Share-into-app: forward from WhatsApp/TikTok/Facebook/Instagram into the feed.
  app.use('/api/share-into-app', shareIntoAppRoutes);
  // The phone's Share menu sends shared items here. Normally the app's
  // service worker (client/public/sw.js) catches them first; if it isn't
  // running yet, this just opens the Share screen (the shared files can't
  // come along that way, so the screen asks to try again).
  app.post('/share-target', (_req, res) => res.redirect(303, '/share?missed=1'));
  // Phase 2: Prayer requests (public wall or private-to-leadership), plus comments.
  app.use('/api/prayer-requests', prayerRequestsRoutes);
  // Friends, people search, blocking, reports, member-to-member messages.
  app.use('/api/member', socialRoutes);
  app.use('/api/admin/member-reports', adminMemberReportsRouter);
  app.use('/api/leader/member-reports', leaderMemberReportsRouter);
  // Geographical Leadership Directory (the sole Leadership Directory — an
  // earlier free-text RepresentationRequest version was retired): the
  // Admin-managed area tree + area leadership assignments, a Member's own
  // "request to represent an area" (targeting a real GeographicArea) and
  // its Admin review, and the Member-facing directory browse/search
  // endpoints.
  app.use('/api/admin', adminGeographicAreasRoutes);
  app.use('/api/admin', adminAreaRepresentationRequestsRoutes);
  app.use('/api/member', areaRepresentationRequestsRoutes);
  // A Member's own referral link and "My Referrals" page.
  app.use('/api/member', memberReferralsRoutes);
  // What a member earns from the books bought by people they invited, and payouts.
  app.use('/api/member', memberEarningsRoutes);
  app.use('/api/admin', adminPayoutsRoutes);
  app.use('/api/member', paymentOrdersRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/admin', adminPaymentAgentsRoutes);
  // Exam World: member summary/reader, admin library & trainees, leader results.
  app.use('/api/member', examWorldRoutes);
  // Automatic Mobile Money: the payment company's notifications (lib/payments.ts).
  app.use('/api/payments', paymentRoutes);
  app.use('/api/admin/library', adminLibraryRoutes);
  app.use('/api/leader', leaderExamResultsRoutes);
  app.use('/api/leader', leaderResultsRoutes);

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
      // The start page is built here (not sent as a plain file) so every
      // shared link gets its own title, picture and sentence; see lib/ogMeta.ts.
      // The guide folders (e.g. /leader-guide/) keep being served as plain files.
      const indexTemplate = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8');
      const spa = spaHandler(indexTemplate, APP_URL, async (slug, lang) => {
        const row = await prisma.contentPage.findFirst({ where: { slug, published: true }, select: { titleEn: true, titleFr: true, bodyEn: true, bodyFr: true } });
        if (!row) return null;
        return lang === 'fr' && row.titleFr ? { title: row.titleFr, text: row.bodyFr ?? row.bodyEn } : { title: row.titleEn, text: row.bodyEn };
      });
      app.get('/', spa);
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
      app.get('*', spa);
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
