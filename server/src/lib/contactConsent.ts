import type { ConsentChannel, Prisma, PrismaClient } from '@prisma/client';

// Recorded consent to be contacted. Every choice is one new, never-edited row
// (ContactConsent); the latest row for a person and channel is what counts.
// The sentence stored is the exact one the person was shown, written here, so
// it cannot be altered by whoever sends the request.

type Db = PrismaClient | Prisma.TransactionClient;
type Lang = 'en' | 'fr';

export const CONSENT_WORDING: Record<ConsentChannel, Record<Lang, string>> = {
  WHATSAPP: {
    en: 'Yes, send me updates and encouragement from The God Nation on WhatsApp.',
    fr: 'Oui, envoyez-moi les nouvelles et les encouragements de The God Nation sur WhatsApp.',
  },
  EMAIL: {
    en: 'Yes, send me updates and encouragement from The God Nation by email.',
    fr: 'Oui, envoyez-moi les nouvelles et les encouragements de The God Nation par e-mail.',
  },
};

export type ConsentSource = 'signup' | 'stay-connected' | 'profile';

export async function recordConsent(
  db: Db,
  who: { personId?: string; leadId?: string },
  channel: ConsentChannel,
  granted: boolean,
  source: ConsentSource,
  language: Lang,
  at: Date = new Date(),
) {
  return db.contactConsent.create({
    data: {
      personId: who.personId ?? null,
      leadId: who.leadId ?? null,
      channel,
      granted,
      wording: CONSENT_WORDING[channel][language],
      source,
      createdAt: at,
    },
  });
}

export interface ConsentState {
  whatsapp: boolean | null;
  email: boolean | null;
}

/** The person's current choices; null means they were never asked or never answered. */
export async function currentConsent(db: Db, personId: string): Promise<ConsentState> {
  const rows = await db.contactConsent.findMany({
    where: { personId },
    orderBy: { createdAt: 'desc' },
    select: { channel: true, granted: true },
  });
  const pick = (c: ConsentChannel) => rows.find((r) => r.channel === c)?.granted ?? null;
  return { whatsapp: pick('WHATSAPP'), email: pick('EMAIL') };
}

/**
 * When a new member signs up with a number that was left in the "stay
 * connected" box, the lead becomes that member and their recorded choices move
 * to the member (the dates and the wording they saw are kept).
 */
export async function convertLeadToMember(db: Db, personId: string, whatsappNumber: string): Promise<boolean> {
  const lead = await db.lead.findUnique({ where: { whatsappNumber }, include: { consents: true } });
  if (!lead || lead.convertedPersonId) return false;
  const now = new Date();
  await db.lead.update({ where: { id: lead.id }, data: { convertedPersonId: personId, convertedAt: now } });
  for (const c of lead.consents) {
    await db.contactConsent.create({
      data: { personId, channel: c.channel, granted: c.granted, wording: c.wording, source: c.source, createdAt: c.createdAt },
    });
  }
  return true;
}
