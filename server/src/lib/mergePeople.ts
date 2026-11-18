import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { closeFollowUpsOfNewLeader } from './followRules';

// One person with two accounts: everything of the duplicate moves to the account that is kept, then the duplicate is
// removed. His leader roles, the people he follows, who follows him, his assemblies and groups, friends, chats, posts
// and learning progress all continue on the kept account.
//
// How it is done safely:
//  - Every place the database points to a person is found from the schema itself (not a hand-kept list), so a table
//    added later is merged too.
//  - Everything runs in ONE transaction: if anything fails, nothing changes.
//  - The preview (dry run) runs the very same steps and then rolls back, so what it reports is exactly what the real
//    merge would do, and a conflict shows up before anything is touched.
//  - Where both accounts have the same thing that may only exist once (for example both are members of the same
//    assembly), the kept account's one stays and the duplicate's copy is dropped.

interface Ref {
  model: string;
  table: string;
  column: string;
  optional: boolean;
  /** Each group of columns that must be unique together and includes this column (as database column names). */
  groups: string[][];
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

let cached: Ref[] | null = null;
/** Every field in the schema that points to a Person. */
function personReferences(): Ref[] {
  if (cached) return cached;
  const models = Prisma.dmmf.datamodel.models;
  const refs: Ref[] = [];
  for (const m of models) {
    const columnOf = (fieldName: string) => {
      const f = m.fields.find((x) => x.name === fieldName);
      return f?.dbName ?? f?.name ?? fieldName;
    };
    for (const f of m.fields) {
      if (f.kind !== 'object' || f.type !== 'Person' || !f.relationFromFields?.length) continue;
      const fk = f.relationFromFields[0];
      const scalar = m.fields.find((x) => x.name === fk);
      if (!scalar) continue;
      const seen = new Set<string>();
      const groups: string[][] = [];
      const add = (fields: readonly string[]) => {
        if (!fields.includes(fk)) return;
        const key = [...fields].sort().join(',');
        if (seen.has(key)) return;
        seen.add(key);
        groups.push(fields.map(columnOf));
      };
      if (scalar.isUnique) add([fk]);
      for (const u of m.uniqueFields ?? []) add(u);
      for (const u of m.uniqueIndexes ?? []) add(u.fields);
      if (m.primaryKey) add(m.primaryKey.fields);
      refs.push({ model: m.name, table: m.dbName ?? m.name, column: scalar.dbName ?? scalar.name, optional: !scalar.isRequired, groups });
    }
  }
  cached = refs;
  return refs;
}

// A pair of people that stops making sense when the two accounts become one (he cannot follow, befriend or block himself).
const SELF_PAIRS: { model: string; a: string; b: string }[] = [
  { model: 'FollowUpAssignment', a: 'followerId', b: 'followedPersonId' },
  { model: 'Friendship', a: 'requesterPersonId', b: 'addresseePersonId' },
  { model: 'Follow', a: 'followerPersonId', b: 'followingPersonId' },
  { model: 'PersonBlock', a: 'blockerPersonId', b: 'blockedPersonId' },
  { model: 'MemberReport', a: 'reporterPersonId', b: 'reportedPersonId' },
  { model: 'PrivateConversation', a: 'memberPersonId', b: 'initiatorPersonId' },
];

export interface MergeSummary {
  /** Leader, representative and team roles that moved. */
  roles: number;
  /** People he follows up (as a leader) that moved. */
  peopleHeFollows: number;
  /** Leaders who follow him up, that moved. */
  leadersFollowingHim: number;
  /** Assemblies and groups he belongs to. */
  memberships: number;
  /** Chat messages (assemblies, private, follow-up, rooms). */
  messages: number;
  /** Posts, comments, prayer requests and teachings. */
  posts: number;
  /** Exams, books opened, reading and payments. */
  learning: number;
  /** Everything else that moved (notifications, reads, reactions, friends…). */
  other: number;
  /** Things both accounts had that may exist only once: the kept account's stays, the duplicate's is dropped. */
  dropped: number;
  /** Links between the two accounts themselves (they cannot follow or befriend each other any more). */
  betweenThem: number;
}

export interface MergeReport {
  summary: MergeSummary;
  /** The sign-in email of the duplicate, which stops working: the person signs in with the kept account's email. */
  droppedSignInEmail: string | null;
  /** The duplicate's name and WhatsApp number, for the record. */
  duplicate: { name: string; whatsappNumber: string };
}

export type MergeResult = { ok: true; report: MergeReport; dryRun: boolean } | { ok: false; error: string };

const GROUPS: { key: keyof MergeSummary; models: string[] }[] = [
  { key: 'roles', models: ['RoleAssignment', 'GenerationRepresentative', 'AreaLeadershipAssignment', 'NationalTeamMember'] },
  { key: 'memberships', models: ['CommunityMembership'] },
  { key: 'messages', models: ['Message', 'PrivateMessage', 'FollowUpMessage', 'LeadershipCollaborationMessage'] },
  { key: 'posts', models: ['UpdatePost', 'UpdateComment', 'HeadquartersPost', 'HeadquartersPostComment', 'PrayerRequest', 'PrayerRequestComment', 'Teaching'] },
  { key: 'learning', models: ['Attempt', 'TrainingBookOpen', 'TeachingProgress', 'ReadingProgress', 'TrainingEnrollment', 'BookPayment', 'TokenEntry', 'PersonalAnswer', 'FaithRecord'] },
];

class DryRunDone extends Error {
  constructor(readonly report: MergeReport) {
    super('dry run');
  }
}

/** A short description of one account, to choose the right one to keep. */
export async function describePerson(personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      name: true,
      whatsappNumber: true,
      lastSeenAt: true,
      createdAt: true,
      memberAccount: { select: { email: true } },
      users: { select: { email: true, role: true } },
    },
  });
  if (!person) return null;
  const [roles, memberships, peopleHeFollows, leadersFollowingHim, messages] = await Promise.all([
    prisma.roleAssignment.findMany({ where: { personId, status: 'ACTIVE' }, select: { community: { select: { name: true } } } }),
    prisma.communityMembership.count({ where: { personId, status: 'ACTIVE' } }),
    prisma.followUpAssignment.count({ where: { followerId: personId, status: 'ACTIVE' } }),
    prisma.followUpAssignment.count({ where: { followedPersonId: personId, status: 'ACTIVE' } }),
    prisma.message.count({ where: { senderPersonId: personId } }),
  ]);
  return {
    id: person.id,
    name: person.name,
    whatsappNumber: person.whatsappNumber,
    signInEmail: person.memberAccount?.email ?? null,
    leaderSignIn: person.users.some((u) => u.role === 'LEADER'),
    leaderOf: roles.map((r) => r.community?.name).filter((n): n is string => Boolean(n)),
    assemblies: memberships,
    peopleHeFollows,
    leadersFollowingHim: leadersFollowingHim,
    messages,
    lastSeenAt: person.lastSeenAt,
    createdAt: person.createdAt,
  };
}

/**
 * Merge the duplicate account (`mergeId`) into the one that stays (`keepId`).
 * `dryRun` does everything and then rolls back, so nothing changes and the report shows what would happen.
 */
export async function mergePeople(keepId: string, mergeId: string, opts: { dryRun?: boolean } = {}): Promise<MergeResult> {
  if (keepId === mergeId) return { ok: false, error: 'Choose two different accounts.' };
  const [keep, dup] = await Promise.all([
    prisma.person.findUnique({ where: { id: keepId }, select: { id: true, name: true, whatsappNumber: true, memberAccount: { select: { email: true } }, users: { select: { id: true } } } }),
    prisma.person.findUnique({ where: { id: mergeId }, select: { id: true, name: true, whatsappNumber: true, memberAccount: { select: { email: true } }, users: { select: { id: true } } } }),
  ]);
  if (!keep || !dup) return { ok: false, error: 'One of the accounts was not found.' };
  if ((await isCentralAdminPerson(keep.id)) || (await isCentralAdminPerson(dup.id))) {
    return { ok: false, error: 'The central admin account cannot be merged.' };
  }
  if (keep.users.length > 0 && dup.users.length > 0) {
    return { ok: false, error: 'Both accounts have their own leader sign-in. Remove the leader sign-in of the duplicate first, then merge.' };
  }

  const summary: MergeSummary = { roles: 0, peopleHeFollows: 0, leadersFollowingHim: 0, memberships: 0, messages: 0, posts: 0, learning: 0, other: 0, dropped: 0, betweenThem: 0 };
  const report: MergeReport = {
    summary,
    droppedSignInEmail: keep.memberAccount && dup.memberAccount ? dup.memberAccount.email : null,
    duplicate: { name: dup.name, whatsappNumber: dup.whatsappNumber },
  };

  try {
    await prisma.$transaction(
      async (tx) => {
        const refs = personReferences();
        const run = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);

        // 1. Things that may exist only once, which both accounts have: the kept account's stays.
        for (const r of refs) {
          if (r.model === 'User') continue; // handled below: the leader sign-in moves to the kept account
          for (const g of r.groups) {
            const others = g.filter((c) => c !== r.column);
            if (others.length === 0) {
              if (r.optional) {
                summary.dropped += await run(`UPDATE ${q(r.table)} SET ${q(r.column)} = NULL WHERE ${q(r.column)} = $1 AND EXISTS (SELECT 1 FROM ${q(r.table)} WHERE ${q(r.column)} = $2)`, dup.id, keep.id);
              } else {
                summary.dropped += await run(`DELETE FROM ${q(r.table)} WHERE ${q(r.column)} = $1 AND EXISTS (SELECT 1 FROM ${q(r.table)} WHERE ${q(r.column)} = $2)`, dup.id, keep.id);
              }
            } else {
              const same = others.map((c) => `s.${q(c)} = p.${q(c)}`).join(' AND ');
              summary.dropped += await run(`DELETE FROM ${q(r.table)} s USING ${q(r.table)} p WHERE s.${q(r.column)} = $1 AND p.${q(r.column)} = $2 AND ${same}`, dup.id, keep.id);
            }
          }
        }

        // 2. Links between the two accounts themselves.
        for (const pair of SELF_PAIRS) {
          const ref = refs.find((x) => x.model === pair.model);
          if (!ref) continue;
          const col = (model: string, field: string) => {
            const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model)!;
            const f = m.fields.find((x) => x.name === field)!;
            return q(f.dbName ?? f.name);
          };
          const a = col(pair.model, pair.a);
          const b = col(pair.model, pair.b);
          summary.betweenThem += await run(`DELETE FROM ${q(ref.table)} WHERE (${a} = $1 AND ${b} = $2) OR (${a} = $2 AND ${b} = $1) OR (${a} = $1 AND ${b} = $1)`, dup.id, keep.id);
        }

        // 3. The leader sign-in (if the duplicate has one) moves to the kept account.
        await run(`UPDATE "User" SET "personId" = $2 WHERE "personId" = $1`, dup.id, keep.id);

        // 4. Everything else moves.
        for (const r of refs) {
          if (r.model === 'User') continue;
          const moved = await run(`UPDATE ${q(r.table)} SET ${q(r.column)} = $2 WHERE ${q(r.column)} = $1`, dup.id, keep.id);
          if (moved === 0) continue;
          const group = GROUPS.find((g) => g.models.includes(r.model));
          if (r.model === 'FollowUpAssignment') {
            if (r.column === 'followerId') summary.peopleHeFollows += moved;
            else summary.leadersFollowingHim += moved;
          } else if (group) {
            summary[group.key] += moved;
          } else {
            summary.other += moved;
          }
        }

        // 5. The duplicate is gone.
        await tx.person.delete({ where: { id: dup.id } });

        if (opts.dryRun) throw new DryRunDone(report);
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (err) {
    if (err instanceof DryRunDone) return { ok: true, report: err.report, dryRun: true };
    console.error('[mergePeople] failed', { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'The accounts could not be merged, and nothing was changed. Please tell the developer.' };
  }

  // He may now be a leader: leaders are followed up only by the central admin and the representatives.
  await closeFollowUpsOfNewLeader(keep.id).catch(() => {});
  return { ok: true, report, dryRun: false };
}
