import { prisma } from './prisma';

// Phase 3A: links every Registration that doesn't yet have a Person to one,
// keyed by its normalized WhatsApp number — the strongest existing identity
// signal, since Phase 1 already guarantees Registration.normalizedWhatsApp
// is unique. `connectOrCreate` makes this idempotent: re-running only ever
// touches rows still missing a personId, and even a row that somehow ran
// twice would resolve to the same Person via the unique whatsappNumber
// constraint rather than creating a duplicate.
//
// Existing User records are intentionally left untouched here. A User has
// no WhatsApp number in the current schema, so there is no safe, existing
// identity signal to match an existing User against a Person — and a
// shared email address alone is never sufficient grounds to merge two
// identities (two different humans can share a household email; the same
// human can use two different emails for their User login and their
// Registration). Every existing User keeps personId = null after this
// runs, which is the correct, safe outcome for Phase 3A — not a bug to
// work around with a heuristic merge.
export async function backfillPersonsFromRegistrations(): Promise<{ linked: number }> {
  const unlinked = await prisma.registration.findMany({
    where: { personId: null },
    select: { id: true, normalizedWhatsApp: true, name: true, email: true, language: true, isTestData: true },
  });

  let linked = 0;
  for (const reg of unlinked) {
    await prisma.registration.update({
      where: { id: reg.id },
      data: {
        person: {
          connectOrCreate: {
            where: { whatsappNumber: reg.normalizedWhatsApp },
            create: {
              name: reg.name,
              whatsappNumber: reg.normalizedWhatsApp,
              email: reg.email,
              preferredLanguage: reg.language,
              isTestData: reg.isTestData,
            },
          },
        },
      },
    });
    linked++;
  }

  return { linked };
}
