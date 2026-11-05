import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma, type User } from '@prisma/client';
import { prisma } from './prisma';
import { getOrCreatePersonReferralCode } from './referralCode';
import { notifyLeaderDashboardMovedIfNeeded } from './notifications';
import { recordAudit } from './audit';

export type LeaderAccountResult =
  | { status: 'CREATED'; user: User }
  | { status: 'ALREADY'; user: User }
  | { status: 'NO_MEMBER_ACCOUNT' }
  | { status: 'EMAIL_TAKEN' };

/**
 * Makes an existing member a Leader (a Leader account linked to their person, so the "My Leadership
 * Dashboard" opens in the app). Their own referral link keeps working and now carries Leader attribution.
 * Safe to repeat: a person who already has an account is left as they are. Nobody ever signs in with the
 * placeholder password stored here: the member signs in as always and the Leader session pairs by itself.
 */
export async function ensureLeaderAccount(personId: string, actor: { id: string; email: string }): Promise<LeaderAccountResult> {
  const person = await prisma.person.findUnique({ where: { id: personId }, include: { memberAccount: true } });
  if (!person?.memberAccount) return { status: 'NO_MEMBER_ACCOUNT' };

  const existing = await prisma.user.findUnique({ where: { personId } });
  if (existing) return { status: 'ALREADY', user: existing };

  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  let leader: User;
  try {
    leader = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: person.name,
          email: person.email ?? person.memberAccount!.email,
          passwordHash: unusablePasswordHash,
          role: 'LEADER',
          active: true,
          isTestData: person.isTestData,
          mustChangePassword: false,
          personId,
        },
      });
      const code = await getOrCreatePersonReferralCode(tx, personId, person.name);
      await tx.referralCode.update({ where: { id: code.id }, data: { leaderId: user.id } });
      return user;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { status: 'EMAIL_TAKEN' };
    throw err;
  }

  await notifyLeaderDashboardMovedIfNeeded(leader);
  await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: 'LEADER_ASSIGNED_FROM_MEMBER', targetType: 'User', targetId: leader.id, metadata: { personId, name: person.name } });
  return { status: 'CREATED', user: leader };
}
