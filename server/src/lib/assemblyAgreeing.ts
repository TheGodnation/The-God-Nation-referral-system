import { prisma } from './prisma';
import { CLIENT_URL } from './env';
import { agreementRequired } from './assemblyAgreement';
import { announceJoined } from './joinNotice';
import { centralAdminPerson } from './trainingWelcome';
import { sendPrivateNotice, isFrench } from './privateNotice';
import { communityNameFor } from './communityName';

/** The private message that tells the person they are now part of the assembly, with a link into it. */
export function agreedMessage(french: boolean, assemblyName: string, communityId: string): string {
  const url = `${CLIENT_URL.replace(/\/+$/, '')}/member/chats/group/${communityId}${french ? '?lang=fr' : ''}`;
  return french
    ? `Vous faites maintenant partie de ${assemblyName}. 🙏 Vous pouvez y écrire et répondre. Touchez pour l’ouvrir :\n${url}`
    : `You are now part of ${assemblyName}. 🙏 You can write and reply there. Tap to open it:\n${url}`;
}

export type AgreeResult = { ok: true; alreadyAgreed: boolean } | { ok: false; status: number; error: string };

/**
 * The person agrees to the rules of this assembly (once): from now on they can write and reply. They get a private
 * message from the National Coordinator with a link into the assembly. The "just joined" line already appeared when
 * they were added; only someone who was added before that (and so never had the line) gets it now.
 */
export async function agreeToAssembly(personId: string, communityId: string): Promise<AgreeResult> {
  const membership = await prisma.communityMembership.findUnique({ where: { personId_communityId: { personId, communityId } }, select: { status: true } });
  if (membership?.status !== 'ACTIVE') return { ok: false, status: 403, error: 'You are not a member of this assembly.' };
  if (!(await agreementRequired(personId, communityId))) return { ok: true, alreadyAgreed: true };

  const created = await prisma.assemblyAgreement.upsert({
    where: { personId_communityId: { personId, communityId } },
    create: { personId, communityId },
    update: {},
    select: { agreedAt: true },
  });
  void created;

  // The join line was shown when they were added; it is shown now only if it never was.
  await announceJoined(communityId, [personId], { onlyIfNeverAnnounced: true });
  try {
    const [from, person, community] = await Promise.all([
      centralAdminPerson(),
      prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true, erasedAt: true, isTestData: true } }),
      prisma.community.findUnique({ where: { id: communityId }, select: { name: true, nameFr: true } }),
    ]);
    if (from && person && !person.erasedAt && !person.isTestData && community && from.id !== personId) {
      const french = isFrench(person.preferredLanguage);
      await sendPrivateNotice(from.id, personId, agreedMessage(french, communityNameFor(community, french), communityId));
    }
  } catch (err) {
    console.error('[agreement] could not send the message', { error: err instanceof Error ? err.message : String(err) });
  }
  return { ok: true, alreadyAgreed: false };
}
