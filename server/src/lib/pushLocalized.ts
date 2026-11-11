import { prisma } from './prisma';
import { pushToPersons, type PushPayload } from './push';

/**
 * A phone alert written in each person's own language: `build(french)` makes the alert for French readers (true) or
 * English readers (false), and each group gets theirs. Best effort: never throws.
 */
export async function pushToPersonsLocalized(personIds: string[], build: (french: boolean) => PushPayload): Promise<void> {
  try {
    if (personIds.length === 0) return;
    const rows = await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, preferredLanguage: true } });
    const fr = rows.filter((r) => String(r.preferredLanguage ?? '').toLowerCase().startsWith('fr')).map((r) => r.id);
    const en = personIds.filter((id) => !fr.includes(id));
    if (en.length) await pushToPersons(en, build(false));
    if (fr.length) await pushToPersons(fr, build(true));
  } catch {
    // best effort
  }
}
