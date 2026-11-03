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

export function isTransientConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /PostgreSQL connection|kind:\s*Closed|Connection.*closed|ECONNRESET/i.test(message);
}

/**
 * The database could not be reached at all (it is waking up, or the network blinked). The query
 * never ran, so trying again can never do it twice. A sleeping free-plan database can take a
 * few seconds to wake, so these are retried a few times with growing pauses.
 */
export function isUnreachableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'P1001' || code === 'P1002') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Can't reach database server|Timed out trying to connect|ETIMEDOUT|ECONNREFUSED/i.test(message);
}

export const UNREACHABLE_PAUSES_MS = [500, 1500, 3000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The production database closes connections that have sat idle for a
// while (recurring "Error in PostgreSQL connection: Error { kind: Closed }"
// in the logs) — normal behavior for most hosted Postgres plans, but the
// very next query handed that now-dead pooled connection fails outright
// instead of transparently reconnecting. One immediate retry on a fresh
// connection resolves it in practice; a database that cannot be reached at
// all is retried a few times with growing pauses (see above); anything else
// is rethrown untouched.
// $use (not $extends) deliberately — it wraps every query without changing
// `prisma`'s own type, so every existing call site typed against the plain
// PrismaClient (helper functions taking a `tx`/`Db` parameter, etc.) keeps
// compiling unchanged.
export async function retryTransient<T>(run: () => Promise<T>, pauses: number[] = UNREACHABLE_PAUSES_MS): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUnreachableError(err)) {
      let last: unknown = err;
      for (const pause of pauses) {
        await sleep(pause);
        try {
          return await run();
        } catch (again) {
          last = again;
          if (!isUnreachableError(again)) throw again;
        }
      }
      throw last;
    }
    if (!isTransientConnectionError(err)) throw err;
    await sleep(150);
    return await run();
  }
}

prisma.$use((params, next) => retryTransient(() => next(params)));
