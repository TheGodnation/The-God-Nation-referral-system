import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';

// ---------------------------------------------------------------------------
// The weekly invitation to give, posted in each assembly's group chat by the
// central admin's profile: giving is free-will, never required, and here is
// how. It never names anyone and never shows an amount. Off when the central
// admin turns it off or has written no instructions yet.
// ---------------------------------------------------------------------------

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function givingPostText(instructionsEn: string | null, instructionsFr: string | null): string {
  const en = ['Giving this week. Giving is a free-will gift and is never required. Your gift goes straight to the central administration.', instructionsEn?.trim() || '', 'Open "Give" in the app to tell us you have given.'].filter(Boolean).join('\n');
  const fr = ["Donner cette semaine. Donner est un geste libre et n'est jamais obligatoire. Votre don va directement à l'administration centrale.", instructionsFr?.trim() || instructionsEn?.trim() || '', 'Ouvrez « Donner » dans l\'application pour nous dire que vous avez donné.'].filter(Boolean).join('\n');
  return `${en}\n\n${fr}`;
}

/** Posts the weekly invitation (once a week) in every assembly's chat. Returns how many assemblies were posted to. */
export async function processGivingPost(now = new Date()): Promise<number> {
  const s = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { givingWeeklyPost: true, givingInstructionsEn: true, givingInstructionsFr: true, lastGivingPostAt: true },
  });
  if (!s?.givingWeeklyPost) return 0;
  if (!s.givingInstructionsEn?.trim() && !s.givingInstructionsFr?.trim()) return 0;
  if (s.lastGivingPostAt && now.getTime() - s.lastGivingPostAt.getTime() < WEEK) return 0;

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true, personId: { not: null } }, select: { personId: true } });
  if (!admin?.personId) return 0;

  // Claim the week first, so two servers never post twice.
  const claimed = await prisma.settings.updateMany({
    where: { id: 'singleton', lastGivingPostAt: s.lastGivingPostAt },
    data: { lastGivingPostAt: now },
  });
  if (claimed.count === 0) return 0;

  const conversations = await prisma.conversation.findMany({ where: { community: { active: true } }, select: { id: true } });
  const body = givingPostText(s.givingInstructionsEn, s.givingInstructionsFr);
  for (const c of conversations) await prisma.message.create({ data: { conversationId: c.id, senderPersonId: admin.personId, body } });
  return conversations.length;
}

export function startGivingPostLoop(): void {
  startAdaptiveLoop(processGivingPost, (err) => console.error('[giving] weekly post failed', { error: err instanceof Error ? err.message : String(err) }));
}
