import crypto from 'crypto';
import { prisma } from './prisma';
import { hashToken } from './auth';
import { CLIENT_URL } from './env';

// "Help them sign in" — for someone who forgot their password and can't get
// the emailed codes (wrong address, mailbox full, no data for email...): a
// private link the central admin sends them on WhatsApp. It works once, for
// 24 hours, and lets them choose a new password themselves — the admin never
// sees or sets it. Making another link does not stop one already sent (the
// admin page may have reloaded after going to WhatsApp, hiding the link it
// had made); once any of them is used, the rest stop working. Made from
// Admin → People (adminPeople.ts) and Admin → Leaders (admin.ts).

const SIGN_IN_HELP_HOURS = 24;

/**
 * For finding out why a link someone opened was refused: `ref` is the start
 * of the link's stored hash (never the link itself), the same `ref` the
 * redeem routes log (see linkRef).
 */
export function linkRef(rawToken: string): string {
  return hashToken(rawToken).slice(0, 10);
}

function logLinkMade(kind: 'MEMBER' | 'LEADER', accountId: string, raw: string, expiresAt: Date) {
  console.info('[sign-in-help] link made', JSON.stringify({ kind, accountId, ref: linkRef(raw), tokenLength: raw.length, expiresAt: expiresAt.toISOString() }));
}

export interface SignInHelpLink {
  url: string;
  expiresAt: Date;
  /** MEMBER: the app's own page (/member/password-help). LEADER: the leader page's /reset-password. */
  kind: 'MEMBER' | 'LEADER';
}

function newLink() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, expiresAt: new Date(Date.now() + SIGN_IN_HELP_HOURS * 60 * 60 * 1000) };
}

export async function memberSignInHelpLink(memberAccountId: string, adminUserId: string): Promise<SignInHelpLink> {
  const { raw, expiresAt } = newLink();
  await prisma.memberPasswordHelpLink.create({ data: { memberAccountId, tokenHash: hashToken(raw), createdByUserId: adminUserId, expiresAt } });
  logLinkMade('MEMBER', memberAccountId, raw, expiresAt);
  return { url: `${CLIENT_URL}/member/password-help?token=${raw}`, expiresAt, kind: 'MEMBER' };
}

export async function leaderSignInHelpLink(userId: string): Promise<SignInHelpLink> {
  const { raw, expiresAt } = newLink();
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: hashToken(raw), expiresAt } });
  logLinkMade('LEADER', userId, raw, expiresAt);
  return { url: `${CLIENT_URL}/reset-password?token=${raw}`, expiresAt, kind: 'LEADER' };
}
