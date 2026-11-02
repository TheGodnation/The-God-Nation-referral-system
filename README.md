# The God Nation

The app of **The God Nation** (thegodnationacademy.org): an installable web
app (PWA) in English and French where members join a community, chat in their
assemblies, follow the Leadership School and the Dominion Clinic, pray, give,
and earn King's Tokens. Leaders care for their people; the central
administration oversees the whole.

## What is in the box

```
/
├── client/   React + TypeScript + Vite + Tailwind + React Router + i18next (the PWA)
├── server/   Node.js + TypeScript + Express + Prisma + PostgreSQL
├── docs/     Backups guide, Phase 5 (King's Token) plan, Play Store readiness report
├── e2e/      Playwright browser tests (local test database only)
└── .env.example
```

Main parts: member sign-up and sign-in, assemblies and group/private chat,
leaders' dashboards and follow-up, Leadership School books and exams, Dominion
Clinic, giving, King's Tokens, events, prayer requests, payment agents, and the
central admin dashboard. Referral links (`/join?ref=CODE`) record the visit and
send the visitor to sign-up (`/member/join`); the older `/welcome` and
`/register` links still work and lead to the same place.

## Run it on your computer

Needs Node.js 18+, PostgreSQL 14+ and npm 10+.

```bash
npm install
cp .env.example server/.env        # then fill in DATABASE_URL etc.
npm run prisma:generate
npm run prisma:migrate             # creates the tables
npm run seed                       # first admin and starter data

npm run dev:server                 # http://localhost:4000
npm run dev:client                 # http://localhost:5173 (proxies /api to :4000)
```

All the settings (links, WhatsApp numbers and groups, giving instructions,
King's Token switches, assembly size...) are set by the central admin inside
the app, not in environment variables. See `.env.example` for the few real
environment variables (database, email, storage, push keys, translation).

## Tests

```bash
cd server && createdb godnation_test   # once; point .env.test at it
npm test                               # server, against a real Postgres test database
npm run test:client                    # client component tests
npm run test:e2e                       # browser tests (see e2e/README.md)
```

The server tests use one shared test database, so run one suite at a time.
Type-check with `npx tsc --noEmit -p .` in `client/` and `server/`.

## Production

```bash
npm run build       # server (prisma generate + tsc) and client (tsc + vite build)
```

Hosted on Render. Pushing to the tracked branch builds and deploys
automatically: `npm install && npm run build`, then `prisma migrate deploy`,
then the seed. The database is on Neon; backups are described in
`docs/BACKUPS.md`.

## Security notes

- Passwords are hashed with bcrypt; sessions are opaque random tokens and only
  a SHA-256 hash is stored.
- Cookies are httpOnly, `SameSite=Lax`, and `Secure` in production.
- CSRF protection (double-submit cookie) is required on every mutating request.
- The visitor cookie is opaque: it never carries a referral code or any
  attribution data.

## More

- `docs/PHASE_5_KINGS_TOKEN.md` — what is built and what is left for King's Tokens.
- `docs/PLAY_STORE_READINESS_AND_CLEANUP.md` — the clean-up report and Play Store plan.
- `docs/BACKUPS.md` — nightly database backup and restore.
