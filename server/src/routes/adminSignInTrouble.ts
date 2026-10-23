import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';
import { PENDING_MEMBER_SIGNUP_TTL_MS } from '../lib/env';

// ---------------------------------------------------------------------------
// Admin → Sign-in trouble: everyone who tried and is still stuck, so the
// central admin can reach out ("Help them sign in", or fix a misspelled
// email). Only people who have NOT got in since are listed:
//   LEADER_SIGN_IN    wrong password on the leader page
//   MEMBER_SIGN_IN    wrong password or wrong code in the app
//   UNFINISHED_SIGNUP started joining (code emailed) but never finished
// Read-only; built from what sign-in already records (LoginAttempt,
// AuditLog, PendingMemberSignup).
// ---------------------------------------------------------------------------

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

type Kind = 'LEADER_SIGN_IN' | 'MEMBER_SIGN_IN' | 'UNFINISHED_SIGNUP';

interface Item {
  email: string;
  kind: Kind;
  failedTries: number;
  lastTriedAt: Date;
  name: string | null;
  whatsappNumber: string | null;
  /** Whether an account with this email exists (a "no" often means a misspelled email). */
  hasAccount: boolean;
  /** For "Help them sign in": the leader account and/or the person. */
  leaderId: string | null;
  personId: string | null;
}

const MEMBER_PREFIX = 'member:';
const MAX_ITEMS = 500;

router.get('/', asyncHandler(async (req, res) => {
  const { days } = querySchema.parse(req.query);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Wrong passwords (leader page, and the app's "member:" ones), grouped by email.
  const failed = await prisma.loginAttempt.groupBy({
    by: ['identifier'],
    where: { success: false, createdAt: { gte: since } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const lastSuccess = new Map(
    (
      await prisma.loginAttempt.groupBy({
        by: ['identifier'],
        where: { success: true, identifier: { in: failed.map((f) => f.identifier) } },
        _max: { createdAt: true },
      })
    ).map((s) => [s.identifier, s._max.createdAt!]),
  );

  // Wrong 6-digit codes in the app.
  const wrongCodes = await prisma.auditLog.groupBy({
    by: ['targetId'],
    where: { action: 'MEMBER_LOGIN_CODE_WRONG', createdAt: { gte: since } },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  // Each "send me a new code" pushes expiresAt on, so it dates the last try.
  const pending = await prisma.pendingMemberSignup.findMany({
    where: { expiresAt: { gte: new Date(since.getTime() + PENDING_MEMBER_SIGNUP_TTL_MS) } },
    select: { email: true, expiresAt: true, codeAttempts: true },
  });

  // Who these emails belong to.
  const leaderEmails = failed.filter((f) => !f.identifier.startsWith(MEMBER_PREFIX)).map((f) => f.identifier);
  const memberEmails = [
    ...failed.filter((f) => f.identifier.startsWith(MEMBER_PREFIX)).map((f) => f.identifier.slice(MEMBER_PREFIX.length)),
    ...pending.map((p) => p.email),
  ];
  const personSelect = { id: true, name: true, whatsappNumber: true, erasedAt: true } as const;
  const [users, accounts, codeAccounts] = await Promise.all([
    prisma.user.findMany({
      where: { email: { in: leaderEmails } },
      select: { id: true, email: true, name: true, role: true, person: { select: { ...personSelect, memberAccount: { select: { lastLoginAt: true } } } } },
    }),
    prisma.memberAccount.findMany({
      where: { email: { in: memberEmails } },
      select: { id: true, email: true, lastLoginAt: true, person: { select: { ...personSelect, users: { select: { id: true, role: true } } } } },
    }),
    prisma.memberAccount.findMany({
      where: { id: { in: wrongCodes.map((w) => w.targetId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, email: true, lastLoginAt: true, person: { select: { ...personSelect, users: { select: { id: true, role: true } } } } },
    }),
  ]);
  const userByEmail = new Map(users.map((u) => [u.email, u]));
  const accountByEmail = new Map([...accounts, ...codeAccounts].map((a) => [a.email, a]));
  const accountById = new Map(codeAccounts.map((a) => [a.id, a]));

  const items = new Map<string, Item>();
  const add = (item: Item) => {
    const key = `${item.kind}:${item.email}`;
    const prev = items.get(key);
    if (!prev) return items.set(key, item);
    prev.failedTries += item.failedTries;
    if (item.lastTriedAt > prev.lastTriedAt) prev.lastTriedAt = item.lastTriedAt;
  };
  const gotInSince = (when: Date, ...logins: (Date | null | undefined)[]) => logins.some((l) => l && l > when);
  const memberItem = (account: (typeof accounts)[number]) => {
    const leader = account.person.users.find((u) => u.role === 'LEADER') ?? null;
    return {
      name: account.person.name,
      whatsappNumber: account.person.whatsappNumber,
      hasAccount: true,
      leaderId: leader?.id ?? null,
      personId: account.person.id,
    };
  };

  for (const f of failed) {
    const last = f._max.createdAt!;
    if (gotInSince(last, lastSuccess.get(f.identifier))) continue;
    if (f.identifier.startsWith(MEMBER_PREFIX)) {
      const email = f.identifier.slice(MEMBER_PREFIX.length);
      const account = accountByEmail.get(email);
      if (account && gotInSince(last, account.lastLoginAt)) continue;
      add({
        email,
        kind: 'MEMBER_SIGN_IN',
        failedTries: f._count._all,
        lastTriedAt: last,
        ...(account ? memberItem(account) : { name: null, whatsappNumber: null, hasAccount: false, leaderId: null, personId: null }),
      });
    } else {
      const user = userByEmail.get(f.identifier);
      if (user?.role === 'ADMIN') continue;
      // A leader who has since signed in to the app is in (their leader account comes with it).
      if (user && gotInSince(last, user.person?.memberAccount?.lastLoginAt)) continue;
      const person = user?.person && !user.person.erasedAt ? user.person : null;
      add({
        email: f.identifier,
        kind: 'LEADER_SIGN_IN',
        failedTries: f._count._all,
        lastTriedAt: last,
        name: person?.name ?? user?.name ?? null,
        whatsappNumber: person?.whatsappNumber ?? null,
        hasAccount: Boolean(user),
        leaderId: user?.id ?? null,
        personId: person?.id ?? null,
      });
    }
  }

  for (const w of wrongCodes) {
    const account = w.targetId ? accountById.get(w.targetId) : undefined;
    const last = w._max.createdAt!;
    if (!account || gotInSince(last, account.lastLoginAt)) continue;
    add({ email: account.email, kind: 'MEMBER_SIGN_IN', failedTries: w._count._all, lastTriedAt: last, ...memberItem(account) });
  }

  for (const p of pending) {
    // Finished since under the same email (the pending row is normally removed then).
    if (accountByEmail.has(p.email)) continue;
    add({
      email: p.email,
      kind: 'UNFINISHED_SIGNUP',
      failedTries: p.codeAttempts,
      lastTriedAt: new Date(p.expiresAt.getTime() - PENDING_MEMBER_SIGNUP_TTL_MS),
      name: null,
      whatsappNumber: null,
      hasAccount: false,
      leaderId: null,
      personId: null,
    });
  }

  const list = [...items.values()].sort((a, b) => b.lastTriedAt.getTime() - a.lastTriedAt.getTime());
  res.json({ days, total: list.length, items: list.slice(0, MAX_ITEMS) });
}));

export default router;
