// Runs `prisma migrate deploy` over a direct (non-pooled) database
// connection — schema.prisma's `directUrl = env("DIRECT_URL")`.
//
// Migrate takes a session-level Postgres advisory lock. Through Neon's
// pooled endpoint (PgBouncer, transaction mode) that lock can be left
// stranded on a pooled server connection, so the next deploy waits on a
// lock nobody will release and fails with P1002 — even with nothing else
// deploying. App traffic keeps using the pooled DATABASE_URL; only
// migrations need the direct connection.
//
// DIRECT_URL wins when set. Otherwise it's derived from DATABASE_URL: Neon's
// direct host is the pooled host without "-pooler" (a no-op for any
// non-Neon URL, e.g. a local database), so no second copy of the database
// password has to be kept in sync by hand.
const { execFileSync } = require('child_process');

function directUrlFrom(databaseUrl) {
  return databaseUrl.replace(/@([^/?#]*?)-pooler\./, '@$1.');
}

const env = { ...process.env };
if (!env.DIRECT_URL && env.DATABASE_URL) {
  env.DIRECT_URL = directUrlFrom(env.DATABASE_URL);
}

const args = ['prisma', 'migrate', 'deploy', ...process.argv.slice(2)];
try {
  execFileSync('npx', args, { stdio: 'inherit', env });
} catch (err) {
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
