import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, hashToken } from '../lib/auth';
import { requireMember, MEMBER_SESSION_COOKIE_NAME } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { accountDeletionLimiter, communityMutationLimiter } from '../lib/rateLimit';
import { EmailService } from '../lib/email';
import { AccountDeletionError, DELETION_WAIT_DAYS, cancelAccountDeletion, completeAccountDeletion, requestAccountDeletion } from '../lib/accountDeletion';

// ---------------------------------------------------------------------------
// "Delete my account" — see lib/accountDeletion.ts for the rules.
//   memberRouter  /api/member/account   the member asks, in the app
//   publicRouter  /api/account-deletion the public web page (Google Play)
//   adminRouter   /api/admin/account-deletions  the central admin decides
// ---------------------------------------------------------------------------

const ERRORS: Record<AccountDeletionError['code'], { status: number; error: string }> = {
  ADMIN_ACCOUNT: { status: 409, error: 'The central admin’s account cannot be deleted from the app.' },
  NOT_FOUND: { status: 404, error: 'Account not found.' },
  NOT_READY: { status: 409, error: 'The month of waiting is not over yet.' },
  NOT_PENDING: { status: 409, error: 'This request is already closed.' },
};

function sendError(res: any, err: unknown) {
  if (err instanceof AccountDeletionError) {
    const e = ERRORS[err.code];
    return res.status(e.status).json({ error: e.error, code: err.code });
  }
  throw err;
}

async function emailScheduled(personId: string, readyAt: Date) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { name: true, preferredLanguage: true, memberAccount: { select: { email: true } } } });
  if (person?.memberAccount) {
    await EmailService.sendAccountDeletionScheduled({ to: person.memberAccount.email, name: person.name, language: person.preferredLanguage, readyAt }).catch(() => {});
  }
}

// ----------------------------- In the app -----------------------------------

export const memberRouter = Router();

const memberDeleteSchema = z.object({ password: z.string().max(200).optional(), confirm: z.literal(true) });

// POST /api/member/account/delete — the member confirms with their password
// (when their account has one); they are signed out at once.
memberRouter.post('/delete', accountDeletionLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = memberDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please confirm that you understand.', code: 'NOT_CONFIRMED' });
  const personId = req.member!.personId;
  const account = await prisma.memberAccount.findUnique({ where: { personId }, select: { passwordHash: true } });
  if (account?.passwordHash && !(parsed.data.password && (await bcrypt.compare(parsed.data.password, account.passwordHash)))) {
    return res.status(401).json({ error: 'That password is not right.', code: 'WRONG_PASSWORD' });
  }
  try {
    const request = await requestAccountDeletion(personId, 'APP');
    await emailScheduled(personId, request.readyAt);
    res.clearCookie(MEMBER_SESSION_COOKIE_NAME, { path: '/' });
    res.json({ readyAt: request.readyAt, days: DELETION_WAIT_DAYS });
  } catch (err) {
    sendError(res, err);
  }
}));

// ----------------------------- Public web page -------------------------------

export const publicRouter = Router();

const CODE_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const GENERIC = { message: 'If this email belongs to a The God Nation account, we sent a 6-digit code to it.' };
const emailSchema = z.object({ email: z.string().trim().email().max(320) });
const confirmSchema = emailSchema.extend({ code: z.string().trim().regex(/^\d{6}$/) });
const hashCode = (id: string, code: string) => hashToken(`deletion:${id}:${code}`);

// POST /api/account-deletion/request-code — always the same answer, so it
// never reveals who has an account.
publicRouter.post('/request-code', accountDeletionLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please enter a valid email address.', code: 'INVALID_EMAIL' });
  const email = parsed.data.email.toLowerCase();
  const account = await prisma.memberAccount.findUnique({ where: { email }, include: { person: { select: { name: true, preferredLanguage: true } } } });
  if (account) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const id = crypto.randomUUID();
    await prisma.accountDeletionCode.create({ data: { id, email, codeHash: hashCode(id, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) } });
    await EmailService.sendAccountDeletionCode({ to: email, name: account.person.name, language: account.person.preferredLanguage, code }).catch(() => {});
  }
  res.json(GENERIC);
}));

// POST /api/account-deletion/confirm — the code from the email starts the
// same month of waiting as in the app.
publicRouter.post('/confirm', accountDeletionLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  const bad = { error: 'That code is not right or has expired. Ask for a new code.', code: 'BAD_CODE' };
  if (!parsed.success) return res.status(400).json(bad);
  const email = parsed.data.email.toLowerCase();
  const codes = await prisma.accountDeletionCode.findMany({
    where: { email, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  const match = codes.find((c) => c.codeHash === hashCode(c.id, parsed.data.code));
  if (!match) {
    if (codes.length) await prisma.accountDeletionCode.updateMany({ where: { id: { in: codes.map((c) => c.id) } }, data: { attempts: { increment: 1 } } });
    return res.status(400).json(bad);
  }
  const claim = await prisma.accountDeletionCode.updateMany({ where: { id: match.id, usedAt: null }, data: { usedAt: new Date() } });
  const account = await prisma.memberAccount.findUnique({ where: { email }, select: { personId: true } });
  if (claim.count !== 1 || !account) return res.status(400).json(bad);
  try {
    const request = await requestAccountDeletion(account.personId, 'WEB');
    await emailScheduled(account.personId, request.readyAt);
    res.json({ readyAt: request.readyAt, days: DELETION_WAIT_DAYS });
  } catch (err) {
    sendError(res, err);
  }
}));

// ----------------------------- Central admin ---------------------------------

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

// GET /api/admin/account-deletions — open requests (oldest first, with the
// day each can be deleted) and the latest closed ones.
adminRouter.get('/', asyncHandler(async (_req, res) => {
  const [open, closed] = await Promise.all([
    prisma.accountDeletionRequest.findMany({ where: { status: 'PENDING' }, orderBy: { requestedAt: 'asc' } }),
    prisma.accountDeletionRequest.findMany({ where: { status: { not: 'PENDING' } }, orderBy: { requestedAt: 'desc' }, take: 20 }),
  ]);
  const now = Date.now();
  res.json({
    items: open.map((r) => ({
      id: r.id,
      personId: r.personId,
      name: r.personName,
      email: r.email,
      whatsappNumber: r.whatsappNumber,
      source: r.source,
      requestedAt: r.requestedAt,
      readyAt: r.readyAt,
      ready: r.readyAt.getTime() <= now,
      returnedRoles: ((r.returned as { summary?: string[] } | null)?.summary ?? []) as string[],
    })),
    closed: closed.map((r) => ({ id: r.id, status: r.status, requestedAt: r.requestedAt, cancelledAt: r.cancelledAt, cancelledBy: r.cancelledBy, completedAt: r.completedAt })),
  });
}));

const decisionSchema = z.object({ decision: z.enum(['DELETE', 'KEEP']) });

// POST /api/admin/account-deletions/:id — DELETE (only after the month) or KEEP.
adminRouter.post('/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid decision.' });
  const request = await prisma.accountDeletionRequest.findUnique({ where: { id: req.params.id } });
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'PENDING' || !request.personId) return sendError(res, new AccountDeletionError('NOT_PENDING'));
  try {
    if (parsed.data.decision === 'KEEP') await cancelAccountDeletion(request.personId, 'ADMIN', req.user!.id);
    else await completeAccountDeletion(request.id, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}));
