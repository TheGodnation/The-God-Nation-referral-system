import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { profilePhotoPath } from './profilePhoto';

// "Possible duplicates": pairs of accounts that may be ONE person. It only suggests; nothing is changed here. Three signs:
//   email: the same inbox written differently (Gmail ignores dots and "+tag": john.doe+1@gmail.com is johndoe@gmail.com)
//   name:  the same words, whatever the order, capitals or accents ("Ndoh Stanley" = "stanley ndoh")
//   phone: the same last 8 digits (a number written with another country code or prefix)

export type Sign = 'email' | 'name' | 'phone';

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** The inbox an email really reaches (null when it is not an email). */
export function emailKey(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (!domain || domain.endsWith('.invalid')) return null;
  local = local.split('+')[0];
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return local ? `${local}@${domain}` : null;
}

/** The same dot-free Gmail inbox, WITHOUT ignoring "+tag" (used to stop a second sign-up with dots moved around). */
export function gmailDotKey(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const domain = e.slice(at + 1);
  if (!GMAIL.has(domain)) return null;
  const local = e.slice(0, at).replace(/\./g, '');
  return local ? `${local}@gmail.com` : null;
}

/** The words of a name, without accents or capitals, in alphabetical order; null for a name too short to be telling. */
export function nameKey(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n || n.includes('@')) return null; // the placeholder name of a sign-up is the email
  const words = n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return words.length >= 2 ? [...words].sort().join(' ') : null;
}

export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

export interface SuspectPerson {
  id: string;
  name: string;
  photoUrl: string | null;
  whatsappNumber: string;
  signInEmail: string | null;
  joinedAt: string;
  hasAccount: boolean;
}
export interface Suspect {
  a: SuspectPerson;
  b: SuspectPerson;
  signs: Sign[];
}

const MAX_GROUP = 6; // a key shared by more people than this is too common to be telling
const MAX_PAIRS = 100;

const orderIds = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export async function findDuplicateSuspects(): Promise<Suspect[]> {
  const [people, dismissed] = await Promise.all([
    prisma.person.findMany({
      where: { erasedAt: null, isTestData: false },
      select: {
        id: true,
        name: true,
        whatsappNumber: true,
        email: true,
        createdAt: true,
        photoStorageKey: true,
        photoUpdatedAt: true,
        memberAccount: { select: { email: true } },
      },
    }),
    prisma.duplicateDismissal.findMany({ select: { personAId: true, personBId: true } }),
  ]);
  const skip = new Set(dismissed.map((d) => `${d.personAId}|${d.personBId}`));

  const groups: Record<Sign, Map<string, string[]>> = { email: new Map(), name: new Map(), phone: new Map() };
  const add = (sign: Sign, key: string | null, id: string) => {
    if (!key) return;
    const list = groups[sign].get(key) ?? [];
    list.push(id);
    groups[sign].set(key, list);
  };
  for (const p of people) {
    // Both the sign-in email and the contact email count (a person can have only one of them filled in).
    const keys = new Set([emailKey(p.memberAccount?.email), emailKey(p.email)].filter((k): k is string => !!k));
    for (const k of keys) add('email', k, p.id);
    add('name', nameKey(p.name), p.id);
    add('phone', phoneKey(p.whatsappNumber), p.id);
  }

  const pairs = new Map<string, Set<Sign>>();
  for (const sign of ['email', 'name', 'phone'] as Sign[]) {
    for (const ids of groups[sign].values()) {
      if (ids.length < 2 || ids.length > MAX_GROUP) continue;
      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const [x, y] = orderIds(unique[i], unique[j]);
          const key = `${x}|${y}`;
          if (skip.has(key)) continue;
          const set = pairs.get(key) ?? new Set<Sign>();
          set.add(sign);
          pairs.set(key, set);
        }
      }
    }
  }

  const byId = new Map(people.map((p) => [p.id, p]));
  const view = (id: string): SuspectPerson => {
    const p = byId.get(id)!;
    return {
      id: p.id,
      name: p.name,
      photoUrl: profilePhotoPath({ id: p.id, photoStorageKey: p.photoStorageKey, photoUpdatedAt: p.photoUpdatedAt }),
      whatsappNumber: p.whatsappNumber,
      signInEmail: p.memberAccount?.email ?? p.email ?? null,
      joinedAt: p.createdAt.toISOString(),
      hasAccount: Boolean(p.memberAccount),
    };
  };
  const out: Suspect[] = [];
  for (const [key, signs] of pairs) {
    const [x, y] = key.split('|');
    if (!byId.has(x) || !byId.has(y)) continue;
    // Older account first: it is the one with the history.
    const [first, second] = byId.get(x)!.createdAt <= byId.get(y)!.createdAt ? [x, y] : [y, x];
    out.push({ a: view(first), b: view(second), signs: [...signs] });
  }
  out.sort((l, r) => r.signs.length - l.signs.length || r.b.joinedAt.localeCompare(l.b.joinedAt));
  return out.slice(0, MAX_PAIRS);
}

export async function dismissSuspect(idA: string, idB: string): Promise<void> {
  const [a, b] = orderIds(idA, idB);
  await prisma.duplicateDismissal.upsert({ where: { personAId_personBId: { personAId: a, personBId: b } }, create: { personAId: a, personBId: b }, update: {} });
}

/**
 * A sign-in account whose Gmail address is the same inbox as `email` with the dots moved ("john.doe@gmail.com" and
 * "johndoe@gmail.com"). Used at sign-up so that second spelling opens the existing account instead of making a new one.
 * "+tag" addresses are NOT treated as the same here (they are used on purpose, for example for test accounts).
 */
export async function findAccountByGmailDots(email: string) {
  const key = gmailDotKey(email);
  if (!key) return null;
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT m."id" FROM "MemberAccount" m
    WHERE split_part(lower(m."email"), '@', 2) IN ('gmail.com', 'googlemail.com')
      AND replace(split_part(lower(m."email"), '@', 1), '.', '') = ${key.split('@')[0]}
    LIMIT 1`);
  if (rows.length === 0) return null;
  return prisma.memberAccount.findUnique({ where: { id: rows[0].id }, include: { person: true } });
}
