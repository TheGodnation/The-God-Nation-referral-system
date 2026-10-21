import crypto from 'crypto';
import { prisma } from './prisma';
import { recordAudit } from './audit';
import { deleteObject, isStorageConfigured } from './storage';

// ---------------------------------------------------------------------------
// "Delete my account" (agreed with the ministry):
//
// 1. The member asks — in the app (Me → Edit profile → Delete my account) or
//    on the public web page Google Play requires (/delete-account, with an
//    emailed code). The account is hidden at once: signed out everywhere,
//    no longer found in searches, friends or groups. Leader roles go back to
//    the central admin. Nothing is deleted yet.
// 2. For one month (DELETION_WAIT_DAYS) signing in again cancels it all and
//    gives the roles back. The central admin can also keep the account.
// 3. After the month, only the central admin approves the deletion
//    (Admin → Account deletions). Then everything goes: profile, photos,
//    groups, friends, posts, exam results, sign-in. Messages in other
//    people's chats stay as ordinary "This message was deleted" bubbles
//    under the person's real name — never saying the account was deleted
//    (as the ministry asked) — and book payments / offerings
//    keep their amount and date without the name.
// ---------------------------------------------------------------------------

export const DELETION_WAIT_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** The name a closed leader account is left with (the person's own name stays only on their old chat messages). */
export const PLACEHOLDER_NAME = 'Member';

export class AccountDeletionError extends Error {
  constructor(public code: 'ADMIN_ACCOUNT' | 'NOT_FOUND' | 'NOT_READY' | 'NOT_PENDING') {
    super(code);
  }
}

interface Returned {
  memberships: string[];
  roleAssignments: string[];
  areaAssignments: string[];
  leaderUserId: string | null;
  /** For the admin: what the member led, in words. */
  summary: string[];
}

/** Starts the month of waiting. Returns the open request (an existing one if already asked). */
export async function requestAccountDeletion(personId: string, source: 'APP' | 'WEB') {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: { memberAccount: { select: { email: true } }, users: { select: { id: true, role: true, active: true } } },
  });
  if (!person || person.erasedAt) throw new AccountDeletionError('NOT_FOUND');
  // The central admin's own account is never deleted from the app: another
  // admin would be left without anyone to approve or run things.
  if (person.users.some((u) => u.role === 'ADMIN')) throw new AccountDeletionError('ADMIN_ACCOUNT');

  const open = await prisma.accountDeletionRequest.findFirst({ where: { personId, status: 'PENDING' } });
  if (open) return open;

  const [memberships, roles, areas] = await Promise.all([
    prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { id: true } }),
    prisma.roleAssignment.findMany({ where: { personId, status: 'ACTIVE' }, select: { id: true, roleType: true, community: { select: { name: true } } } }),
    prisma.areaLeadershipAssignment.findMany({ where: { personId, status: 'ACTIVE' }, select: { id: true, area: { select: { name: true } } } }),
  ]);
  const leaderUser = person.users.find((u) => u.role === 'LEADER' && u.active) ?? null;
  const returned: Returned = {
    memberships: memberships.map((m) => m.id),
    roleAssignments: roles.map((r) => r.id),
    areaAssignments: areas.map((a) => a.id),
    leaderUserId: leaderUser?.id ?? null,
    summary: [
      ...roles.map((r) => (r.community ? `Leader of ${r.community.name}` : 'Leader')),
      ...areas.map((a) => `Represents ${a.area.name}`),
      ...(leaderUser && roles.length === 0 ? ['Leader account'] : []),
    ],
  };

  const now = new Date();
  const [request] = await prisma.$transaction([
    prisma.accountDeletionRequest.create({
      data: {
        personId,
        source,
        personName: person.name,
        email: person.memberAccount?.email ?? person.email,
        whatsappNumber: person.whatsappNumber,
        requestedAt: now,
        readyAt: new Date(now.getTime() + DELETION_WAIT_DAYS * DAY),
        returned: returned as any,
      },
    }),
    prisma.person.update({ where: { id: personId }, data: { deletionRequestedAt: now } }),
    // Hidden: out of their groups, leader roles back to the central admin.
    prisma.communityMembership.updateMany({ where: { id: { in: returned.memberships } }, data: { status: 'INACTIVE' } }),
    prisma.roleAssignment.updateMany({ where: { id: { in: returned.roleAssignments } }, data: { status: 'ENDED', endedAt: now } }),
    prisma.areaLeadershipAssignment.updateMany({ where: { id: { in: returned.areaAssignments } }, data: { status: 'ENDED', endedAt: now } }),
    ...(leaderUser ? [prisma.user.update({ where: { id: leaderUser.id }, data: { active: false } }), prisma.session.deleteMany({ where: { userId: leaderUser.id } })] : []),
    // Signed out everywhere, and no more notifications on their phones.
    prisma.memberSession.deleteMany({ where: { memberAccount: { personId } } }),
    prisma.pushSubscription.deleteMany({ where: { personId } }),
  ]);
  await recordAudit({ action: 'ACCOUNT_DELETION_REQUESTED', targetType: 'Person', targetId: personId, metadata: { source, returned: returned.summary } });
  return request;
}

/** Cancels an open request (the member signed in again, or the admin kept the account); gives back what was returned. */
export async function cancelAccountDeletion(personId: string, by: 'MEMBER' | 'ADMIN', adminUserId?: string): Promise<boolean> {
  const open = await prisma.accountDeletionRequest.findFirst({ where: { personId, status: 'PENDING' } });
  if (!open) {
    // Nothing open, but never leave someone hidden by mistake.
    await prisma.person.updateMany({ where: { id: personId, deletionRequestedAt: { not: null } }, data: { deletionRequestedAt: null } });
    return false;
  }
  const r = (open.returned ?? {}) as Partial<Returned>;
  await prisma.$transaction([
    prisma.accountDeletionRequest.update({
      where: { id: open.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: by, decidedByUserId: adminUserId ?? null, personName: null, email: null, whatsappNumber: null },
    }),
    prisma.person.update({ where: { id: personId }, data: { deletionRequestedAt: null } }),
    // Back in their groups and roles — only those still as they were left.
    prisma.communityMembership.updateMany({ where: { id: { in: r.memberships ?? [] }, status: 'INACTIVE' }, data: { status: 'ACTIVE' } }),
    prisma.roleAssignment.updateMany({ where: { id: { in: r.roleAssignments ?? [] }, status: 'ENDED' }, data: { status: 'ACTIVE', endedAt: null } }),
    prisma.areaLeadershipAssignment.updateMany({ where: { id: { in: r.areaAssignments ?? [] }, status: 'ENDED' }, data: { status: 'ACTIVE', endedAt: null } }),
    ...(r.leaderUserId ? [prisma.user.updateMany({ where: { id: r.leaderUserId, personId }, data: { active: true } })] : []),
  ]);
  await recordAudit({ actorId: adminUserId, action: 'ACCOUNT_DELETION_CANCELLED', targetType: 'Person', targetId: personId, metadata: { by } });
  return true;
}

/**
 * The final deletion, approved by the central admin after the month.
 *
 * The person's chats are first moved to a new, empty placeholder (only
 * their name, so chats look as before; no other details; `erasedAt` set) with every message marked deleted
 * and emptied, so other people's chats keep their shape and simply show
 * "This message was deleted". Then the person is deleted, which removes
 * everything else tied to them (see the Person relations in schema.prisma);
 * book payments and offerings keep their amount and date, without the name.
 */
export async function completeAccountDeletion(requestId: string, adminUserId: string) {
  const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
  if (!request?.personId) throw new AccountDeletionError('NOT_FOUND');
  if (request.status !== 'PENDING') throw new AccountDeletionError('NOT_PENDING');
  if (request.readyAt > new Date()) throw new AccountDeletionError('NOT_READY');
  const personId = request.personId;

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { name: true, preferredLanguage: true, photoStorageKey: true, coverStorageKey: true, users: { select: { id: true, role: true } } },
  });
  if (!person) throw new AccountDeletionError('NOT_FOUND');
  if (person.users.some((u) => u.role === 'ADMIN')) throw new AccountDeletionError('ADMIN_ACCOUNT');

  // Files to remove from storage once the records are gone.
  const [groupFiles, privateFiles, postPhotos] = await Promise.all([
    prisma.messageAttachment.findMany({ where: { OR: [{ uploadedByPersonId: personId }, { message: { senderPersonId: personId } }] }, select: { storageKey: true } }),
    prisma.privateMessageAttachment.findMany({ where: { message: { senderPersonId: personId } }, select: { storageKey: true } }),
    prisma.updatePostPhoto.findMany({ where: { post: { authorPersonId: personId } }, select: { storageKey: true } }),
  ]);
  const files = [
    ...groupFiles.map((f) => f.storageKey),
    ...privateFiles.map((f) => f.storageKey),
    ...postPhotos.map((f) => f.storageKey),
    person.photoStorageKey,
    person.coverStorageKey,
  ].filter((k): k is string => Boolean(k));

  const now = new Date();
  const placeholderId = crypto.randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.person.create({
      data: { id: placeholderId, name: person.name, whatsappNumber: `deleted:${placeholderId}`, preferredLanguage: person.preferredLanguage, erasedAt: now },
    });
    // Group chats: their messages stay, emptied and shown as deleted.
    await tx.messageAttachment.deleteMany({ where: { message: { senderPersonId: personId } } });
    await tx.message.updateMany({
      where: { senderPersonId: personId },
      data: {
        senderPersonId: placeholderId,
        deletedByPersonId: placeholderId,
        deletedAt: now,
        body: null,
        editedAt: null,
        detectedLanguage: null,
        translatedBody: null,
        translatedAt: null,
        transcribedBody: null,
        transcribedLanguage: null,
        translatedTranscript: null,
        transcribedAt: null,
      },
    });
    // Private chats: the other person keeps the conversation.
    await tx.privateConversation.updateMany({ where: { memberPersonId: personId }, data: { memberPersonId: placeholderId } });
    await tx.privateConversation.updateMany({ where: { initiatorPersonId: personId }, data: { initiatorPersonId: placeholderId } });
    await tx.privateMessageAttachment.deleteMany({ where: { message: { senderPersonId: personId } } });
    await tx.privateMessage.updateMany({ where: { senderPersonId: personId }, data: { senderPersonId: placeholderId, deletedAt: now, body: '', editedAt: null } });

    // A leader account linked to them: closed and emptied (its own records stay consistent).
    for (const u of person.users) {
      await tx.session.deleteMany({ where: { userId: u.id } });
      await tx.user.update({
        where: { id: u.id },
        data: {
          active: false,
          personId: null,
          name: PLACEHOLDER_NAME,
          email: `deleted-${u.id}@deleted.invalid`,
          passwordHash: crypto.randomBytes(32).toString('hex'),
        },
      });
    }

    await tx.person.delete({ where: { id: personId } });
    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETED', completedAt: now, decidedByUserId: adminUserId, personName: null, email: null, whatsappNumber: null },
    });
  });

  await recordAudit({ actorId: adminUserId, action: 'ACCOUNT_DELETED', targetType: 'AccountDeletionRequest', targetId: request.id, metadata: { files: files.length } });

  // Best effort: a file that can't be removed now stays private (it is only
  // ever served through signed links to people allowed to see it, and no
  // record points to it any more).
  if (files.length && isStorageConfigured()) {
    await Promise.allSettled(files.map((storageKey) => deleteObject({ storageKey })));
  }
}
