import { prisma } from './prisma';
import { isCentralAdminPerson } from './centralAdmin';
import { authorityFor } from './sanctions';

// The Assembly Agreement. A person who signs up after Settings.assemblyAgreementFrom is already in their group and
// can read everything and react to messages, but cannot post or reply in an assembly until they agree to its rules.
// Agreeing counts as joining it. Everyone who already had an account when the rule started is left alone, and so are
// the central admin, leaders of the assembly and the representative of its generation.

/** Whether this person still has to agree before writing in this assembly. Never throws; false when in doubt. */
export async function agreementRequired(personId: string, communityId: string): Promise<boolean> {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { assemblyAgreementFrom: true } });
    const from = settings?.assemblyAgreementFrom;
    if (!from) return false;
    const account = await prisma.memberAccount.findUnique({ where: { personId }, select: { createdAt: true } });
    // No account, or an account from before the rule started: left alone.
    if (!account || account.createdAt < from) return false;
    if (await isCentralAdminPerson(personId)) return false;
    if (await authorityFor(personId, communityId)) return false;
    const agreed = await prisma.assemblyAgreement.findUnique({ where: { personId_communityId: { personId, communityId } }, select: { id: true } });
    return !agreed;
  } catch (err) {
    console.error('[agreement] could not check', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** The person's own assemblies where they still have to agree, oldest first (for the welcome step). */
export async function pendingAgreements(personId: string): Promise<{ communityId: string }[]> {
  const memberships = await prisma.communityMembership.findMany({
    where: { personId, status: 'ACTIVE' },
    orderBy: { joinedAt: 'asc' },
    select: { communityId: true },
  });
  const pending: { communityId: string }[] = [];
  for (const m of memberships) if (await agreementRequired(personId, m.communityId)) pending.push({ communityId: m.communityId });
  return pending;
}
