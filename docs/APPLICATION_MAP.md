# The God Nation — Application Map (what exists today, and must be protected)

Prepared 3 November 2026 for the Knowledge Centre project. Everything here was read from the code, the hosting settings and the deployment history on this date; nothing was changed. It is the "before" picture that every later phase is tested against.

## 1. The system in one page

| Part | What it is | Where it lives |
|---|---|---|
| The app people see | React 18 + Vite + Tailwind, English and French (i18next), installable as a Progressive Web App | Built into `client/dist`, served by the same server |
| The server | Node.js 22 + Express (TypeScript). About 89 API mount points, 77 route files | One Render web service, Frankfurt, 0.5 CPU and 512 MB, one instance, deploys automatically from the working branch |
| The database | PostgreSQL on Neon (free plan), through Prisma. 112 tables, 115 recorded database changes | Neon |
| Files | Cloudflare R2: photos, voice notes, PDFs, book covers, chat attachments | R2 buckets (private; opened by short-lived signed links) |
| Email | Resend | — |
| Phone notifications | Web Push (VAPID keys set) | Browser and phone push services |
| Translation and drafting help | Google Gemini (free-tier key; see the Knowledge Centre package) | Google |
| Backups | GitHub Actions: nightly encrypted database copy with a restore check; weekly files copy | A private bucket in the same Cloudflare account |
| Tests | 1,736 server tests and 806 screen tests, run before every release | Repository |

The browser and the server share one address (thegodnationacademy.org). The server sends the built app for any address that is not an API call or a file.

## 2. Public and signed-in addresses (the screens)

| Address | Who can open it | Screen |
|---|---|---|
| `/` | Anyone | Public start page (signed-in members are sent on to the app) |
| `/join`, `/welcome` | Anyone | Join page |
| `/register` | Anyone | Redirects to `/member/join` |
| `/login` | Anyone | Admin and leader sign-in |
| `/forgot-password`, `/reset-password`, `/leader/setup` | Anyone with a link | Account recovery and leader set-up |
| `/page/:slug` | Anyone | Admin-edited pages |
| `/teachings`, `/announcements` | Anyone | Public lists |
| `/contact`, `/privacy`, `/delete-account` | Anyone | Contact form, privacy policy, deletion request |
| `/share` | Anyone | Receives shares from the phone's Share menu |
| `/member/login`, `/member/login/confirm`, `/member/password-help`, `/member/join` | Anyone | Member sign-in and sign-up (the only registration system) |
| `/member/complete-profile` and `/member/*` (about 40 screens) | Signed-in members | Chats, groups, people, learn, school, books, reader, downloads, give, events, tokens, clinic, referrals, me, prayer, updates, about, payment desk |
| `/change-password`, `/leader/dashboard`, `/admin/dashboard` | Signed-in staff | Staff screens |
| Any other address | Anyone | Sent back to `/` by the app (but the server answers "200 OK" first; see section 7) |
| `/leader-guide/`, `/no-app-guide/`, `/notifications-guide/`, `/phone-settings-guide/` | Anyone | Plain guide pages kept outside the app |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/sw.js` | Anyone | Search file, crawler file, app identity, service worker |

New public addresses for the Knowledge Centre must use `/en/` and `/fr/`. Neither prefix is used by anything above.

## 3. Server API areas (all under `/api`)

Grouped, not exhaustive. Every state-changing request needs the CSRF token.

| Area | Examples |
|---|---|
| Sign-in and accounts | `/api/auth`, `/api/member/auth`, `/api/member/account`, `/api/account-deletion` |
| Community | `/api/communities`, `/api/chat`, `/api/private-messages`, `/api/prayer-requests`, `/api/updates`, `/api/teachings`, `/api/events`, `/api/follow-ups` |
| Learning and books | `/api/member/clinic`, `/api/admin/library`, `/api/admin/assessments`, `/api/admin/devotionals`, results routes |
| Money | `/api/member/giving`, `/api/payments`, `/api/member/tokens` |
| Growth tools (built this month) | `/api/referrals`, `/api/leads`, `/api/unsubscribe`, `/api/admin/growth`, `/api/admin/reminders`, `/api/admin/ads` and their `/api/member/central-*` copies |
| Admin | `/api/admin/*` (about 25 areas) and the central admin's `/api/member/central-*` mirrors |
| Public information | `/api/settings/public`, `/api/content-pages`, `/api/contact`, `/api/health`, `/sitemap.xml` |

## 4. How sign-in works (do not change)

| Item | Detail |
|---|---|
| Members | Email and password, or a one-time emailed link. Cookie `msid`, HttpOnly, SameSite Lax, 90-day sliding session, stored in its own table |
| Staff (admin, leader) | Cookie `sid`, a separate session table and separate code. A member session can never pass a staff check (a test proves it) |
| Request protection | A `csrf_token` cookie and header on every change request |
| Visitor identity | An opaque `visitor_id` cookie, set on the first request to **any** address, used only for attribution of ads and referral links |
| Central admin | A member whose person is also linked to an admin account; admin tools appear in that member's profile |
| Account deletion | One month hidden, then erased on the central admin's approval |

Both `visitor_id` and `csrf_token` are set by steps that run before every route. This matters for public pages (section 6 of the Knowledge Centre package).

## 5. The installed app and the service worker (the most sensitive part)

| Item | Detail |
|---|---|
| Identity | `id: "/"`, `scope: "/"`, `start_url: /member/chats`, standalone display. The installed app therefore owns every address on the domain |
| What the worker does | Keeps the built JavaScript and images (cache-first); sends all page loads to the network first; if the network fails completely, it shows its saved copy of the app's start page, so downloaded books and chat documents can be read offline; never touches `/api/` or the four guide folders |
| The saved start page | **Any** successful page load (HTML, status 200) overwrites it. Harmless today because all pages are the same app. It becomes harmful when different public pages exist (shown by test, Knowledge Centre package section 5) |
| History | An earlier version that handled page loads more aggressively made the installed app crash on a real Android phone. The current version was rebuilt to be minimal. Any change to it is high-risk and must be tested on real phones |

## 6. Data: what lives in the 112 tables

| Group | Main tables (examples) | Public? |
|---|---|---|
| People and accounts | Person, MemberAccount, MemberSession, User, Session, TrustedMemberDevice, LoginAttempt, PasswordResetToken | Never |
| Referrals and growth | ReferralCode, ReferralVisit, Registration, ReferralRelationship, ReferralEarning, ReferralPayout, Lead, ContactConsent, MemberReminder, AdEventLog | Never |
| Community | Community, CommunityMembership, Conversation, Message and its reactions/attachments, PrivateConversation/PrivateMessage, PrayerRequest, UpdatePost, Friendship, Follow | Never |
| Leadership structure | GeographicArea, AreaLeadershipAssignment, RoleAssignment, FollowUp* tables, NationalTeamMember | Never |
| Learning and books | LibraryBook (private PDFs), BookChapter, Assessment, Question, Option, Attempt, ExamRetakeRequest, TrainingEnrollment, BookPayment, PaymentAgent, PaymentOrder, Teaching, TeachingProgress | Never |
| Giving and tokens | GiftCampaign, Gift, TokenEntry | Never |
| Pages and announcements | ContentPage (public pages), Announcement, HeadquartersPost, Resource | Only ContentPage marked published |
| Settings | Settings (one row: links, reminders, ad ids, wallpapers) | Only the fields published by `/api/settings/public` |
| Safety and records | AuditLog, MemberReport, AccountDeletionRequest, Notification, PushSubscription, TranslationRetry | Never |

`LibraryBook` rows are members' training materials. They must never be reused as the public publications list.

## 7. Things found while mapping (existing behaviour, not changed)

| Finding | Why it matters for the Knowledge Centre |
|---|---|
| Unknown addresses return "200 OK" with the app's empty page, then the app redirects to `/` | Search engines call this a "soft 404". New public areas must return a true 404 for missing pages |
| Public pages are built in the browser; the server only fills in the title, description and preview picture | Crawlers that do not run JavaScript see an empty page (demonstrated) |
| Language is chosen in the browser, not in the address | No separate indexable English and French addresses exist yet |
| `robots.txt` allows everything; `sitemap.xml` lists only home, join and `/page/…` | Needs rewriting; private areas are protected by sign-in, not by robots.txt |
| Database connections sometimes close (Neon free plan sleeps) | Seen in the live logs on 3 November; see the package, section 2 |
| Free-tier Gemini key used for translation | Policy text is disclosed in the privacy page; the free tier's terms are weaker than a paid tier (package, section 7) |

## 8. Integrations and secrets (names only; values are in Render and GitHub)

| Service | Used for | Setting names |
|---|---|---|
| Neon | Database | `DATABASE_URL`, `DIRECT_URL` |
| Cloudflare R2 | Files | R2 access settings in Render; separate settings in GitHub for backups |
| Resend | Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Web Push | Notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Google Gemini | Translation, quiz drafts | `GEMINI_API_KEY`, `GEMINI_QUALITY_MODEL` |
| Mobile Money provider | Automatic payments (ready, optional) | `PAYMENT_PROVIDER` and provider keys |
| Meta, TikTok | Ad measurement (off until set) | `META_CAPI_TOKEN`, `TIKTOK_EVENTS_TOKEN` |
| Unsubscribe links | Signed reminder links | `UNSUBSCRIBE_SECRET` |
| Site address | Links and previews | `APP_URL`, `CLIENT_URL`, `GUIDE_HOST` |

## 9. Protected list: not to be changed without separate approval and testing

1. Member and staff sign-in, sign-up, sessions, cookies and CSRF.
2. All `/member/*`, `/admin/*`, `/leader/*` and `/api/*` addresses and their behaviour.
3. The installed app's identity (`id`, `scope`, `start_url`) and the service worker, except the single, tested exclusion described in the package.
4. Private files, signed links and who may open them.
5. Books, exams, results, payments, giving, tokens and referral records.
6. Existing database tables and their data (new tables only, added by recorded database changes).
7. The nightly and weekly backups and their secrets.
