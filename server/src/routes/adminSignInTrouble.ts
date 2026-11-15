import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';

// ---------------------------------------------------------------------------
// Admin → Sign-in trouble: everyone who tried and is still stuck, so the
// central admin can reach out ("Help them sign in", or fix a misspelled
// email). Only people who have NOT got in since are listed:
//   LEADER_SIGN_IN    wrong password on the leader page
//   MEMBER_SIGN_IN    wrong password or wrong code in the app
// Read-only; built from what sign-in already records (LoginAttempt, AuditLog).
// ---------------------------------------------------------------------------

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

type Kind = 'LEADER_SIGN_IN' | 'MEMBER_SIGN_IN';

interface Item {
  email: string;
  kind: Kind;
  failedTries: number;
  lastTriedAt: Date;
  name: string | null;
  whatsappNumber: string | null;
  /** Whether an account with this email exists (a "no" often means a misspelled email). */
  hasAccount: boolean;
  /** Where the name comes from when there is no sign-in account: the email is on someone's profile or sign-up record. */
  nameSource: 'ACCOUNT' | 'PROFILE' | 'SIGN_UP' | null;
  /** For "Help them sign in": the leader account and/or the person. */
  leaderId: string | null;
  personId: string | null;
  /** Other emails tried from this same phone (same network and same device): often the same person with two emails. */
  sameDevice: { email: string; name: string | null; gotIn: boolean }[];
}

const MEMBER_PREFIX = 'member:';
const MAX_ITEMS = 500;

/**
 * Whose email is this? First a sign-in account (leader or member), then a person's profile email, then the email someone
 * gave when they joined. So the name shows even for an email that cannot sign in (a second email, one typed on the profile).
 */
async function ownersOfEmails(emails: string[]): Promise<Map<string, { name: string; source: 'ACCOUNT' | 'PROFILE' | 'SIGN_UP' }>> {
  const owners = new Map<string, { name: string; source: 'ACCOUNT' | 'PROFILE' | 'SIGN_UP' }>();
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return owners;
  const anyCase = (field: 'email') => wanted.map((e) => ({ [field]: { equals: e, mode: 'insensitive' as const } }));
  const [users, accounts, people, signUps] = await Promise.all([
    prisma.user.findMany({ where: { OR: anyCase('email') }, select: { email: true, name: true, person: { select: { name: true, erasedAt: true } } } }),
    prisma.memberAccount.findMany({ where: { OR: anyCase('email') }, select: { email: true, person: { select: { name: true, erasedAt: true } } } }),
    prisma.person.findMany({ where: { erasedAt: null, OR: anyCase('email') }, select: { email: true, name: true } }),
    prisma.registration.findMany({ where: { OR: anyCase('email') }, select: { email: true, name: true } }),
  ]);
  const put = (email: string | null, name: string | null | undefined, source: 'ACCOUNT' | 'PROFILE' | 'SIGN_UP') => {
    const key = (email ?? '').toLowerCase();
    if (key && name && !owners.has(key)) owners.set(key, { name, source });
  };
  for (const u of users) put(u.email, u.person && !u.person.erasedAt ? u.person.name : u.name, 'ACCOUNT');
  for (const a of accounts) put(a.email, a.person.erasedAt ? null : a.person.name, 'ACCOUNT');
  for (const p of people) put(p.email, p.name, 'PROFILE');
  for (const r of signUps) put(r.email, r.name, 'SIGN_UP');
  return owners;
}

const identifierOf = (item: Pick<Item, 'email' | 'kind'>) => (item.kind === 'MEMBER_SIGN_IN' ? `${MEMBER_PREFIX}${item.email}` : item.email);
const emailOf = (identifier: string) => (identifier.startsWith(MEMBER_PREFIX) ? identifier.slice(MEMBER_PREFIX.length) : identifier);

/**
 * "Same phone also tried": for each person stuck, the other emails tried from the same network address AND the same
 * device (browser/phone), in the period — with the name of whoever owns that email, and whether they got in. It helps tell
 * who is trying two emails: a name is easier to remember than an email.
 */
async function addSameDevice(list: Item[], since: Date) {
  for (const item of list) item.sameDevice = [];
  if (list.length === 0) return;
  const mine = await prisma.loginAttempt.groupBy({
    by: ['identifier', 'ip', 'userAgent'],
    where: { identifier: { in: list.map(identifierOf) }, ip: { not: null }, userAgent: { not: null }, createdAt: { gte: since } },
    orderBy: { identifier: 'asc' },
    take: 5000,
  });
  const ips = [...new Set(mine.map((m) => m.ip as string))];
  if (ips.length === 0) return;
  const all = await prisma.loginAttempt.groupBy({
    by: ['identifier', 'ip', 'userAgent', 'success'],
    where: { ip: { in: ips }, userAgent: { not: null }, createdAt: { gte: since } },
    orderBy: { identifier: 'asc' },
    take: 20000,
  });
  const byDevice = new Map<string, { identifier: string; success: boolean }[]>();
  for (const a of all) {
    const key = `${a.ip}|${a.userAgent}`;
    byDevice.set(key, [...(byDevice.get(key) ?? []), { identifier: a.identifier, success: a.success }]);
  }
  const related = new Map<string, Map<string, boolean>>(); // identifier -> other email -> got in
  for (const m of mine) {
    const others = byDevice.get(`${m.ip}|${m.userAgent}`) ?? [];
    for (const o of others) {
      if (o.identifier === m.identifier) continue;
      const email = emailOf(o.identifier);
      if (email === emailOf(m.identifier)) continue;
      const map = related.get(m.identifier) ?? new Map<string, boolean>();
      map.set(email, (map.get(email) ?? false) || o.success);
      related.set(m.identifier, map);
    }
  }
  const emails = [...new Set([...related.values()].flatMap((m) => [...m.keys()]))];
  if (emails.length === 0) return;
  const owners = await ownersOfEmails(emails);
  for (const item of list) {
    const map = related.get(identifierOf(item));
    if (!map) continue;
    item.sameDevice = [...map.entries()]
      .map(([email, gotIn]) => ({ email, name: owners.get(email.toLowerCase())?.name ?? null, gotIn }))
      .sort((x, y) => Number(y.gotIn) - Number(x.gotIn) || x.email.localeCompare(y.email))
      .slice(0, 3);
  }
}

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

  // Who these emails belong to.
  const leaderEmails = failed.filter((f) => !f.identifier.startsWith(MEMBER_PREFIX)).map((f) => f.identifier);
  const memberEmails = [
    ...failed.filter((f) => f.identifier.startsWith(MEMBER_PREFIX)).map((f) => f.identifier.slice(MEMBER_PREFIX.length)),
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
      nameSource: 'ACCOUNT' as const,
      sameDevice: [] as Item['sameDevice'],
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
        ...(account ? memberItem(account) : { name: null, whatsappNumber: null, hasAccount: false, leaderId: null, personId: null, nameSource: null, sameDevice: [] }),
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
        nameSource: (person?.name ?? user?.name) ? ('ACCOUNT' as const) : null,
        sameDevice: [],
      });
    }
  }

  for (const w of wrongCodes) {
    const account = w.targetId ? accountById.get(w.targetId) : undefined;
    const last = w._max.createdAt!;
    if (!account || gotInSince(last, account.lastLoginAt)) continue;
    add({ email: account.email, kind: 'MEMBER_SIGN_IN', failedTries: w._count._all, lastTriedAt: last, ...memberItem(account) });
  }

  const list = [...items.values()].sort((a, b) => b.lastTriedAt.getTime() - a.lastTriedAt.getTime()).slice(0, MAX_ITEMS);
  // An email with no sign-in account may still be on someone's profile or sign-up: show whose it is.
  const nameless = list.filter((i) => !i.name);
  if (nameless.length > 0) {
    const owners = await ownersOfEmails(nameless.map((i) => i.email));
    for (const item of nameless) {
      const owner = owners.get(item.email.toLowerCase());
      if (owner) {
        item.name = owner.name;
        item.nameSource = owner.source;
      }
    }
  }
  await addSameDevice(list, since);
  res.json({ days, total: list.length, items: list });
}));

export default router;
