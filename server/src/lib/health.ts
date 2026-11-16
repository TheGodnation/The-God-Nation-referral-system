import { prisma } from './prisma';

// What /api/health answers. Render calls it every few seconds once its Health Check Path is set, and during a release
// it keeps the old version serving members until the new one answers 200. So a new version counts as healthy only
// after it has reached the database once since it started: a version that cannot reach the database never replaces
// one that works.
//
// After that first success the database is never queried again by this check, on purpose: a query every few seconds
// would keep the database awake day and night (the database plan may count the hours it is awake), and a short
// connection drop, which the app already rides out (lib/prisma.ts), must not make Render restart the server.

const QUERY_TIMEOUT_MS = 3000;

let reached = false;

export function databaseReached(): boolean {
  return reached;
}

/** True once the database has answered since this server started (tries it now if it has not yet). */
export async function reachDatabaseOnce(timeoutMs = QUERY_TIMEOUT_MS): Promise<boolean> {
  if (reached) return true;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Database did not answer in time.')), timeoutMs);
      }),
    ]);
    reached = true;
  } catch {
    // Not yet: the next health check tries again.
  } finally {
    if (timer) clearTimeout(timer);
  }
  return reached;
}

/** For tests only: back to "just started". */
export function resetHealthForTests(): void {
  reached = false;
}
