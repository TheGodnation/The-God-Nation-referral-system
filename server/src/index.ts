import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { PORT } from './lib/env';

// Last-resort safety net. Every route handler is wrapped in asyncHandler
// (see lib/asyncHandler.ts) specifically so a failed database call — the
// free-tier Postgres this app uses auto-suspends and drops idle
// connections — becomes one clean error response to the one affected
// request, not a crash. This handler is only for anything that somehow
// still slips through (a stray unwrapped handler, a timer, a third-party
// library). Node's default behavior for an unhandled rejection is to kill
// the entire process, which would take the whole site down for every
// visitor at once over what's usually a single recoverable error — so we
// log it loudly instead and keep serving everyone else.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] — process kept alive; this indicates a bug to fix', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] — process kept alive; this indicates a bug to fix', err);
});

const app = createApp();

app.listen(PORT, () => {
  console.log(`The God Nation Referral System API listening on port ${PORT}`);
});
