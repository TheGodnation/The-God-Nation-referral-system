import { prisma } from './prisma';

/**
 * Who a person who joins with nobody's link becomes a friend of ("Referred").
 *
 * 1. The person the central admin chose in Settings, if any.
 * 2. Otherwise automatically the central admin's own member profile (the Person linked to the
 *    earliest active ADMIN account), so nobody is ever left without someone to follow them up.
 */
export async function resolveCatchAllPerson(): Promise<{ id: string; name: string; automatic: boolean } | null> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { defaultReferrerPerson: { select: { id: true, name: true } } },
  });
  if (settings?.defaultReferrerPerson) return { ...settings.defaultReferrerPerson, automatic: false };

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', active: true, personId: { not: null }, person: { erasedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: { person: { select: { id: true, name: true } } },
  });
  return admin?.person ? { ...admin.person, automatic: true } : null;
}

export async function catchAllPersonId(): Promise<string | null> {
  return (await resolveCatchAllPerson())?.id ?? null;
}
