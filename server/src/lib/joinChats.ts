import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// Two people sometimes ended up with TWO private chats between them (one started by each of them, from different doors).
// Both chats show the same name, so the second looks like "another account" and the older messages seem to be gone.
// This finds those pairs and joins them into ONE chat: every message of both, in time order, and each person's
// "read up to here" mark. Nothing is lost; the chat that is left is the older one.

export interface SplitChat {
  keepId: string;
  dropId: string;
  personA: { id: string; name: string };
  personB: { id: string; name: string };
  keepMessages: number;
  dropMessages: number;
  keepStarted: string;
  dropStarted: string;
  lastMessageAt: string | null;
}

interface Row {
  keepId: string;
  dropId: string;
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  keepMessages: bigint;
  dropMessages: bigint;
  keepStarted: Date;
  dropStarted: Date;
  lastMessageAt: Date | null;
}

/** Every pair of person-to-person chats that run in opposite directions between the same two people. */
export async function findSplitChats(onlyForPersonId?: string): Promise<SplitChat[]> {
  const filter = onlyForPersonId ? Prisma.sql`AND (c1."memberPersonId" = ${onlyForPersonId} OR c1."initiatorPersonId" = ${onlyForPersonId})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      CASE WHEN c1."createdAt" <= c2."createdAt" THEN c1."id" ELSE c2."id" END AS "keepId",
      CASE WHEN c1."createdAt" <= c2."createdAt" THEN c2."id" ELSE c1."id" END AS "dropId",
      pa."id" AS "aId", pa."name" AS "aName", pb."id" AS "bId", pb."name" AS "bName",
      (SELECT count(*) FROM "PrivateMessage" m WHERE m."conversationId" = CASE WHEN c1."createdAt" <= c2."createdAt" THEN c1."id" ELSE c2."id" END) AS "keepMessages",
      (SELECT count(*) FROM "PrivateMessage" m WHERE m."conversationId" = CASE WHEN c1."createdAt" <= c2."createdAt" THEN c2."id" ELSE c1."id" END) AS "dropMessages",
      LEAST(c1."createdAt", c2."createdAt") AS "keepStarted",
      GREATEST(c1."createdAt", c2."createdAt") AS "dropStarted",
      (SELECT max(m."createdAt") FROM "PrivateMessage" m WHERE m."conversationId" IN (c1."id", c2."id")) AS "lastMessageAt"
    FROM "PrivateConversation" c1
    JOIN "PrivateConversation" c2
      ON c1."id" < c2."id"
     AND c1."initiatorPersonId" IS NOT NULL AND c2."initiatorPersonId" IS NOT NULL
     AND c1."memberPersonId" = c2."initiatorPersonId" AND c1."initiatorPersonId" = c2."memberPersonId"
    JOIN "Person" pa ON pa."id" = c1."memberPersonId"
    JOIN "Person" pb ON pb."id" = c1."initiatorPersonId"
    WHERE true ${filter}
    ORDER BY "lastMessageAt" DESC NULLS LAST`);
  return rows.map((r) => ({
    keepId: r.keepId,
    dropId: r.dropId,
    personA: { id: r.aId, name: r.aName },
    personB: { id: r.bId, name: r.bName },
    keepMessages: Number(r.keepMessages),
    dropMessages: Number(r.dropMessages),
    keepStarted: r.keepStarted.toISOString(),
    dropStarted: r.dropStarted.toISOString(),
    lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
  }));
}

export type JoinResult = { ok: true; keepId: string; movedMessages: number } | { ok: false; error: string };

/** Joins the chat `dropId` into `keepId` (they must be a split pair, as found above). All or nothing. */
export async function joinChats(keepId: string, dropId: string): Promise<JoinResult> {
  if (keepId === dropId) return { ok: false, error: 'Choose two different chats.' };
  const [keep, drop] = await Promise.all([
    prisma.privateConversation.findUnique({ where: { id: keepId } }),
    prisma.privateConversation.findUnique({ where: { id: dropId } }),
  ]);
  if (!keep || !drop) return { ok: false, error: 'One of the chats no longer exists. Refresh the list.' };
  const sameTwoPeople =
    keep.initiatorPersonId !== null &&
    drop.initiatorPersonId !== null &&
    keep.memberPersonId === drop.initiatorPersonId &&
    keep.initiatorPersonId === drop.memberPersonId;
  if (!sameTwoPeople) return { ok: false, error: 'These two chats are not between the same two people, so they were not joined.' };

  return prisma.$transaction(async (tx) => {
    const moved = await tx.privateMessage.updateMany({ where: { conversationId: drop.id }, data: { conversationId: keep.id } });
    // Each person keeps the LATER of their two "read up to here" marks, so nothing already read shows as new again.
    const reads = await tx.privateConversationRead.findMany({ where: { conversationId: { in: [keep.id, drop.id] } } });
    const best = new Map<string, { personId: string | null; userId: string | null; lastReadAt: Date }>();
    for (const r of reads) {
      const key = r.personId ? `p:${r.personId}` : `u:${r.userId}`;
      const cur = best.get(key);
      if (!cur || r.lastReadAt > cur.lastReadAt) best.set(key, { personId: r.personId, userId: r.userId, lastReadAt: r.lastReadAt });
    }
    await tx.privateConversationRead.deleteMany({ where: { conversationId: { in: [keep.id, drop.id] } } });
    for (const b of best.values()) {
      await tx.privateConversationRead.create({ data: { conversationId: keep.id, personId: b.personId, userId: b.userId, lastReadAt: b.lastReadAt } });
    }
    await tx.privateConversation.delete({ where: { id: drop.id } });
    return { ok: true as const, keepId: keep.id, movedMessages: moved.count };
  });
}
