import crypto from 'crypto';
import { prisma } from './prisma';
import { hashToken } from './auth';
import { CLIENT_URL } from './env';

// "Help them sign in" — for someone who forgot their password and can't get
// the emailed codes (wrong address, mailbox full, no data for email...): a
// private link the central admin sends them on WhatsApp. It works once, for
// 24 hours, and lets them choose a new password themselves — the admin never
// sees or sets it. A new link replaces any earlier one. Made from
// Admin → People (adminPeople.ts) and Admin → Leaders (admin.ts).

const SIGN_IN_HELP_HOURS = 24;

export interface SignInHelpLink {
  url: string;
  expiresAt: Date;
  /** MEMBER: the app's own page (/member/password-help). LEADER: the leader page's /reset-password. */
  kind: 'MEMBER' | 'LEADER';
}

function newLink() {
  const raw = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  return { raw, now, expiresAt: new Date(now.getTime() + SIGN_IN_HELP_HOURS * 60 * 60 * 1000) };
}

export async function memberSignInHelpLink(memberAccountId: string, adminUserId: string): Promise<SignInHelpLink> {
  const { raw, now, expiresAt } = newLink();
  await prisma.$transaction([
    prisma.memberPasswordHelpLink.updateMany({ where: { memberAccountId, usedAt: null }, data: { usedAt: now } }),
    prisma.memberPasswordHelpLink.create({ data: { memberAccountId, tokenHash: hashToken(raw), createdByUserId: adminUserId, expiresAt } }),
  ]);
  return { url: `${CLIENT_URL}/member/password-help?token=${raw}`, expiresAt, kind: 'MEMBER' };
}

export async function leaderSignInHelpLink(userId: string): Promise<SignInHelpLink> {
  const { raw, now, expiresAt } = newLink();
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } }),
    prisma.passwordResetToken.create({ data: { userId, tokenHash: hashToken(raw), expiresAt } }),
  ]);
  return { url: `${CLIENT_URL}/reset-password?token=${raw}`, expiresAt, kind: 'LEADER' };
}
