import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 does not catch a rejected promise thrown by an async route
// handler — it becomes an unhandled promise rejection, and Node's default
// behavior for those is to crash the entire process. That's what almost
// certainly caused real outages here: a transient database hiccup (the
// free-tier Postgres this app uses auto-suspends and drops idle
// connections) inside any one request would take the whole server down
// for every visitor at once, not just that request, until Render noticed
// and restarted it.
//
// Wrapping a handler in asyncHandler forwards any rejection to Express's
// own next(err), which the app's centralized error-handling middleware
// already exists to catch (see the end of createApp in app.ts) — so a
// failed database query now becomes one clean error response to the
// affected request, and every other request keeps working normally.
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}
