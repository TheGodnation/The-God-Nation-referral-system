import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

function isTransientConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /PostgreSQL connection|kind:\s*Closed|Connection.*closed|ECONNRESET/i.test(message);
}

// The production database closes connections that have sat idle for a
// while (recurring "Error in PostgreSQL connection: Error { kind: Closed }"
// in the logs) — normal behavior for most hosted Postgres plans, but the
// very next query handed that now-dead pooled connection fails outright
// instead of transparently reconnecting. One immediate retry on a fresh
// connection resolves it in practice; anything else is rethrown untouched.
// $use (not $extends) deliberately — it wraps every query without changing
// `prisma`'s own type, so every existing call site typed against the plain
// PrismaClient (helper functions taking a `tx`/`Db` parameter, etc.) keeps
// compiling unchanged.
prisma.$use(async (params, next) => {
  try {
    return await next(params);
  } catch (err) {
    if (!isTransientConnectionError(err)) throw err;
    await new Promise((r) => setTimeout(r, 150));
    return await next(params);
  }
});
