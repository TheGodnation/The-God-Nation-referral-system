import { prisma } from './prisma';
import { recordConsent } from './contactConsent';

// What we know about a person's WhatsApp consent, for the people who write to them (the coordinator's desk and leaders).
//  - AGREED: they ticked the box (at sign-up or later in their profile): they may get updates and "we miss you" nudges.
//  - NONE: they never ticked it. A welcome, help finishing sign-up, and an answer to something they wrote are fine;
//    repeated nudges are not, unless the coordinator chooses to include them.
//  - OPTED_OUT: they asked us to stop (the STOP button records it). They are never put in a WhatsApp queue again,
//    whatever the message, until they tick the box again themselves.

export type WhatsAppConsentState = 'AGREED' | 'NONE' | 'OPTED_OUT';
export const WHATSAPP_STOP_SOURCE = 'whatsapp-stop';

/** The current WhatsApp consent of each person: the newest recorded choice decides. */
export async function whatsappConsentOf(personIds: string[]): Promise<Map<string, WhatsAppConsentState>> {
  const result = new Map<string, WhatsAppConsentState>();
  if (personIds.length === 0) return result;
  const rows = await prisma.contactConsent.findMany({
    where: { personId: { in: personIds }, channel: 'WHATSAPP' },
    orderBy: { createdAt: 'desc' },
    select: { personId: true, granted: true, source: true },
  });
  for (const r of rows) {
    if (!r.personId || result.has(r.personId)) continue;
    result.set(r.personId, r.granted ? 'AGREED' : r.source === WHATSAPP_STOP_SOURCE ? 'OPTED_OUT' : 'NONE');
  }
  for (const id of personIds) if (!result.has(id)) result.set(id, 'NONE');
  return result;
}

/** They asked us, in WhatsApp or anywhere else, to stop writing to them there. Recorded like any other choice. */
export async function recordWhatsAppStop(personId: string): Promise<void> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  await recordConsent(prisma, { personId }, 'WHATSAPP', false, WHATSAPP_STOP_SOURCE, person?.preferredLanguage === 'fr' ? 'fr' : 'en');
}
