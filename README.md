# The God Nation Referral System

**Phase 1 — Operational Referral MVP**

The first operational digital system for **The God Nation Media & Leadership
Academy**.

> **Vision:** To leverage modern media to make the Gospel of the Kingdom
> accessible in every nation.
>
> **Mission:** To develop and deploy leaders who multiply disciples through
> scalable digital systems.
>
> **Purpose:** To advance the Gospel of the Kingdom to every nation on earth.

This Phase 1 build implements a complete, working referral engine:

```
Leader → Personal Referral Link → Visitor → Referral Visit → Registration →
Permanent Referral Attribution → Success Page → WhatsApp Community →
WHATSAPP_CLICKED → Leader Dashboard → Admin Dashboard
```

---

## 1. Architecture Overview

A simple, maintainable monorepo — one codebase, one database, no
microservices.

```
/
├── client/   React + TypeScript + Vite + Tailwind + React Router + i18next
├── server/   Node.js + TypeScript + Express + Prisma + PostgreSQL
├── prisma/   (server/prisma) — schema, migrations, seed
├── docs/
├── .env.example
└── README.md
```

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, React Router,
  i18next (English/French).
- **Backend**: Node.js, TypeScript, Express, REST API.
- **Database**: PostgreSQL via Prisma ORM.
- **Testing**: Vitest + Supertest (server, integration/acceptance tests),
  Vitest + React Testing Library (client).
- **Auth**: Database-backed opaque sessions (httpOnly cookies), bcrypt
  password hashing, server-side RBAC (ADMIN / LEADER).
- **CSRF**: Mandatory double-submit cookie pattern on every state-changing
  request.
- **Visitor identity**: A single opaque, httpOnly `visitor_id` cookie —
  never contains referral/attribution data.

---

## 2. Prerequisites

- Node.js 18+
- PostgreSQL 14+ (a local instance, or any reachable Postgres server)
- npm 10+

---

## 3. Environment Setup

Copy the example environment file and fill in real local values:

```bash
cp .env.example server/.env
```

Key variables (see `.env.example` for the full list and comments):

| Variable       | Purpose                                            |
| -------------- | --------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma         |
| `NODE_ENV`     | `development` \| `production` \| `test`             |
| `PORT`         | Port the Express API listens on (default `4000`)    |
| `APP_URL`      | Public base URL of the API                          |
| `CLIENT_URL`   | Public base URL of the client app (used for CORS and building referral links) |

**WhatsApp community URLs are NOT environment variables.** They are
configured by an Admin through the Admin Settings page (`Settings` table),
so they can be changed at any time without a redeploy. See §8.

Install all dependencies (root workspaces install both `server` and `client`):

```bash
npm install
```

---

## 4. Database Setup

Create a local PostgreSQL database (adjust to your own Postgres setup):

```bash
createdb godnation
# or: psql -c "CREATE DATABASE godnation;"
```

Generate the Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate      # applies migrations to DATABASE_URL (dev mode)
```

---

## 5. Seed Data

```bash
npm run seed
```

This creates:

- **An Admin user** with a **cryptographically random password**, printed
  **once** to the console. Copy it immediately — it is never stored in
  plaintext or logged again. (Email defaults to `admin@thegodnation.org`,
  override with `SEED_ADMIN_EMAIL`.)
- **Two test Leaders** (`isTestData = true`, excluded from production
  analytics by default):
  - **Mary Ngu** — `mary.ngu@example.com` / password `password123` /
    referral code **`MARY7X2`**
  - **John Tabi** — `john.tabi@example.com` / password `password123` /
    referral code **`JOHN8K4`**
- A default `Settings` row with placeholder WhatsApp URLs (override via
  `SEED_WHATSAPP_URL_EN` / `SEED_WHATSAPP_URL_FR`, or just edit them later in
  the Admin Settings page).

> Development-only test leader passwords are intentionally simple
> (`password123`) — never use this pattern in production.

The Admin bootstrap account is created with `mustChangePassword = true`. On
first login, the app redirects straight to **Change Password**
(`/change-password`) and blocks access to the dashboard until a new
password is set — via `POST /api/auth/change-password`, which verifies the
current password, requires the new one to be at least 8 characters and
different from the current one, and then clears the flag. The same applies
to any Leader created through the Admin dashboard (their temporary password
is shown once at creation time).

---

## 6. Development

Run the API and the client in two terminals:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173 (Vite proxies /api -> :4000)
```

Then open `http://localhost:5173`.

- **Homepage**: `/`
- **Personal referral link example**: `http://localhost:5173/join?ref=MARY7X2&lang=en`
- **Leader/Admin login**: `/login`

---

## 7. Tests

Server (integration/acceptance tests against a real Postgres test database):

```bash
cd server
createdb godnation_test   # once
cp ../.env.example .env.test   # then point DATABASE_URL at godnation_test
npm run test
```

The suite covers, among others: the full Mary referral→registration→
WhatsApp→dashboard flow, Mary→John latest-visit-wins attribution, permanent
attribution immutability, language switching, 30-day attribution expiration,
duplicate & concurrent registration handling, referral code change history,
WhatsApp redirect authorization (missing/mismatched/matching visitor
cookie), and Leader/Admin authorization boundaries.

Client (component tests):

```bash
cd client
npm run test
```

---

## 8. Configuring WhatsApp Community URLs

There are now **four** configurable WhatsApp destinations, plus a support
link:

1. Log in as Admin at `/login`.
2. Go to **Admin Dashboard → Settings**.
3. Fill in the Training (English/French) and Discover & Grow (English/
   French) invite links, plus the Support WhatsApp link and any social URLs
   you have (blank social fields are simply hidden on the homepage).
4. Save — the change is recorded in the Audit Log.

The Success page's "Join WhatsApp Community" action always redirects through
a secure, server-controlled endpoint
(`GET /api/registrations/:id/whatsapp`) which:

1. Verifies the Registration exists.
2. Requires the request's opaque `visitor_id` cookie to match
   `Registration.visitorId` exactly (missing or mismatched → rejected, no
   redirect, no event).
3. Determines the destination from `Registration.pathway` +
   `Registration.language` (one of the four configured URLs) — never from
   client input.
4. Records a `WHATSAPP_CLICKED` event **before** redirecting.
5. Issues a 302 redirect to the configured WhatsApp URL.

### Website Content

**Admin Dashboard → Website Content** lets you edit the homepage title/
subtitle, both pathways' titles/descriptions/CTA text, the vision statement,
How It Works copy, and a few other simple text fields. This is intentionally
a flat set of named fields, not a full CMS — any field left blank falls back
to the app's built-in default text, and Admin-entered text is shown as-is
regardless of the visitor's selected language.

### Email (Resend)

Leader invitations, registration confirmations, password resets, and Leader
referral-invitation emails are sent via [Resend](https://resend.com), a
Node SDK, and a single `RESEND_API_KEY` server-side environment variable —
configured exactly like `DATABASE_URL`, never exposed to the client. If
`RESEND_API_KEY` is not set, email sending is skipped (logged, not fatal) —
every other flow (registration, WhatsApp redirect, etc.) still works.

Without a verified sending domain in your Resend account, emails can only be
sent from Resend's own sandbox address (`onboarding@resend.dev`), which
only reliably delivers to the Resend account's own verified address. Add
and verify a domain in Resend, then set `EMAIL_FROM` to a real address on
that domain, once you're ready for production email delivery to real
recipients.

---

## 9. Production Build

```bash
npm run build           # builds server (tsc + prisma generate) and client (tsc + vite build)
```

To run the production server:

```bash
cd server
NODE_ENV=production npm start
```

Serve `client/dist` behind your web server / CDN of choice (or a static
file server), with the API reachable at the path your reverse proxy routes
to `server`.

---

## 9a. Leader Onboarding & Password Recovery

**New Leaders** (created from now on) are onboarded via a secure emailed
setup link, never a temporary password:

1. Admin creates the Leader in **Admin Dashboard → Leaders**.
2. A one-time setup link is emailed via Resend (`/leader/setup?token=...`),
   valid for 7 days, single-use — only its SHA-256 hash is ever stored.
3. The Leader opens the link, sets their own password, and is signed in
   directly to their dashboard.
4. If the invitation never arrives, expires, or is lost, Admin can hit
   **Resend Invitation** on that Leader's row — this invalidates the old
   link and issues a new one. Admin can never see or set a Leader's
   password directly.

**Existing accounts** with `mustChangePassword=true` (the Admin bootstrap
account, and any Leader created before this feature) are untouched — they
keep using the original forced `/change-password` flow.

**Password reset** (any account, any time): `/forgot-password` → always
shows the same generic message whether or not the account exists → a
1-hour, single-use reset link is emailed if it does → `/reset-password`
sets a new password and **signs the account out of every existing
session**.

---

## 10. Phase 1 Scope

**Implemented (see the full build report for details):**

- Personal referral links (`/join?ref=CODE&lang=en|fr`)
- Opaque, httpOnly `visitor_id` cookie (no attribution data inside it)
- Server-side referral visit recording, referral code validation
- Database-driven referral attribution (latest applicable visit within a
  30-day window — no query-string persistence required)
- Registration with E.164 WhatsApp normalization, duplicate protection
  (including race-condition-safe concurrent handling)
- Permanent, immutable `ReferralRelationship` per Registration
- Two public visitor pathways (Training, Discover & Grow) on one homepage,
  chosen by intent — never gated on identity, referral attribution always
  silent and unaffected by pathway choice
- Four server-controlled WhatsApp destinations (Training/Discover & Grow ×
  English/French) chosen from `Registration.pathway` + `.language`
- Secure, server-controlled WhatsApp redirect + `WHATSAPP_CLICKED` event
- Leader Dashboard (own data only) + Invite People (WhatsApp/Messenger/Web
  Share, copy link, email invitation) and Admin Dashboard (system-wide,
  with test-data exclusion by default)
- Referral code lifecycle management (deactivate-old/create-new, with full
  history preservation)
- Secure Leader onboarding (emailed one-time setup link) and password reset,
  built on Resend; existing forced-change accounts unaffected
- Simple Admin-editable Website Content + WhatsApp/social Settings
- Authentication (bcrypt, opaque DB-backed sessions), CSRF, rate limiting,
  brute-force protection, audit logging

**Deferred to future phases (intentionally NOT built now):**

- Books, training modules, exams, certificates
- Payments, automated 500 FCFA commission accounting, rewards
- Multilevel referral structures, communities/subgroups
- Live audio, in-app messaging, notifications
- Official WhatsApp Business API integration (membership verification)
- SMS automation, social login, QR referrals
- Native Android/iOS apps, offline sync, background sync, push notifications
- A full CMS for website content (current version is a flat, simple set of
  named text fields, not per-language)

---

## 11. Test Leader Quick Reference

| Name     | Email                     | Password      | Referral Code | English Link                                        | French Link                                          |
| -------- | ------------------------- | -------------- | -------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Mary Ngu | mary.ngu@example.com      | password123    | `MARY7X2`      | `/join?ref=MARY7X2&lang=en`                          | `/join?ref=MARY7X2&lang=fr`                           |
| John Tabi| john.tabi@example.com     | password123    | `JOHN8K4`      | `/join?ref=JOHN8K4&lang=en`                          | `/join?ref=JOHN8K4&lang=fr`                           |

Both are marked `isTestData = true` and are excluded from production
analytics unless the Admin toggles "Include test data (QA)".

---

## 12. Security Notes

- Passwords are hashed with bcrypt; the Admin bootstrap password is
  generated with `crypto.randomBytes` and shown only once.
- Sessions are opaque, cryptographically random tokens; only a SHA-256 hash
  is stored server-side.
- Cookies (`visitor_id`, `sid`) are httpOnly, `SameSite=Lax`, and `Secure`
  in production.
- CSRF protection (double-submit cookie) is mandatory on every mutating
  request — never optional.
- The visitor cookie is strictly opaque: it never carries a referral code,
  Leader ID, or any other attribution data.
- The WhatsApp redirect requires the visitor cookie to match the
  Registration's stored `visitorId` — a valid Registration ID alone is
  never sufficient authorization.

## 13. Deployment

Hosted on Render (`god-nation-referral-app`), connected via Render's GitHub
App installed on this organization — pushing to the tracked branch triggers
an automatic build and deploy; no manual redeploy step is required.
