import bcrypt from 'bcryptjs';
import { Prisma, type User } from '@prisma/client';
import { prisma } from './prisma';
import { normalizeToE164 } from './phone';
import { getOrCreatePersonReferralCode } from './referralCode';

// Shared by leader.ts's /me/create-member-profile (Leader-facing) and
// adminMemberBridge.ts's identical Admin-facing action (Section 27/13 of the
// unified Leader/Member identity build): the one mechanism by which a
// role=LEADER or role=ADMIN User gets their own Person + MemberAccount +
// friends list + personal referral code, "the same functionalities as
// every other person" — bridging an Admin never grants the Leadership
// Dashboard toolset, so the caller (not this shared function) is
// responsible for anything role-specific, such as the Leader-only one-time
// "Leadership Dashboard moved" notice (see lib/notifications.ts's
// notifyLeaderDashboardMovedIfNeeded — never called here, and never for
// ADMIN).

export class MemberBridgeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function bridgeUserToMemberProfile(
  user: User,
  input: { whatsapp: string; password: string; language: 'en' | 'fr' },
) {
  if (user.personId) {
    throw new MemberBridgeError(409, 'Your account is already linked to a Member profile.');
  }

  const normalizedWhatsApp = normalizeToE164(input.whatsapp);
  if (!normalizedWhatsApp) {
    throw new MemberBridgeError(400, 'Please enter a valid phone number, including the country code.');
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const normalizedEmail = user.email.toLowerCase();

  const existingPersonByPhone = await prisma.person.findUnique({
    where: { whatsappNumber: normalizedWhatsApp },
    include: { memberAccount: true },
  });

  if (existingPersonByPhone?.memberAccount && existingPersonByPhone.memberAccount.email !== normalizedEmail) {
    throw new MemberBridgeError(409, 'This WhatsApp number already belongs to a different member account. Please contact an Admin for help.');
  }

  const conflictingAccount = await prisma.memberAccount.findUnique({ where: { email: normalizedEmail } });
  if (conflictingAccount && conflictingAccount.personId !== existingPersonByPhone?.id) {
    throw new MemberBridgeError(409, 'A different member profile already uses your email address. Please contact an Admin for help.');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const person = existingPersonByPhone
        ?? (await tx.person.create({
          data: {
            name: user.name,
            whatsappNumber: normalizedWhatsApp,
            email: normalizedEmail,
            preferredLanguage: input.language,
            isTestData: user.isTestData,
          },
        }));

      const existingLinkForPerson = await tx.user.findUnique({ where: { personId: person.id } });
      if (existingLinkForPerson) {
        throw new MemberBridgeError(409, 'This phone number is already linked to a different account. Please contact an Admin for help.');
      }

      const memberAccount = existingPersonByPhone?.memberAccount
        ? (existingPersonByPhone.memberAccount.passwordHash
            ? existingPersonByPhone.memberAccount
            : await tx.memberAccount.update({ where: { id: existingPersonByPhone.memberAccount.id }, data: { passwordHash } }))
        : await tx.memberAccount.create({ data: { personId: person.id, email: normalizedEmail, passwordHash } });

      await tx.user.update({ where: { id: user.id }, data: { personId: person.id } });

      // Section 1: one code, two jobs. A Leader bridging for the first time
      // already has a leaderId-only ReferralCode from self-signup/Admin
      // creation — that exact code (same string, never replaced) now also
      // gains personId rather than a brand-new one being minted alongside
      // it. An Admin (no leaderId code) or a Person with neither gets a
      // fresh one via getOrCreatePersonReferralCode, same as every other
      // Person at signup.
      const existingPersonCode = await tx.referralCode.findUnique({ where: { personId: person.id } });
      if (!existingPersonCode) {
        const existingLeaderCode = await tx.referralCode.findFirst({ where: { leaderId: user.id } });
        if (existingLeaderCode) {
          await tx.referralCode.update({ where: { id: existingLeaderCode.id }, data: { personId: person.id } });
        } else {
          await getOrCreatePersonReferralCode(tx, person.id, person.name);
        }
      }

      return { memberAccount, person };
    });
  } catch (err) {
    if (err instanceof MemberBridgeError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new MemberBridgeError(409, 'That phone number or email is already in use. Please contact an Admin for help.');
    }
    throw err;
  }
}

export async function setBridgedMemberPassword(user: User, newPassword: string) {
  if (!user.personId) {
    throw new MemberBridgeError(400, 'Link your account to a Member profile first.');
  }
  const memberAccount = await prisma.memberAccount.findUnique({ where: { personId: user.personId } });
  if (!memberAccount) {
    throw new MemberBridgeError(404, 'No Member profile found.');
  }
  if (memberAccount.passwordHash) {
    throw new MemberBridgeError(409, 'A password is already set for your Member profile.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.memberAccount.update({ where: { id: memberAccount.id }, data: { passwordHash } });
  return memberAccount;
}
