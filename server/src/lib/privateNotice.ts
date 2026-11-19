import { prisma } from './prisma';
import { getOrCreatePrivateConversation } from './privateMessaging';
import { notifyPrivateMessageReceived } from './notifications';

/**
 * A short ordinary private message from one person to another, in their normal private chat (the same kind of
 * message "Message all my people" sends). Never throws: a notice that cannot be sent must not undo what caused it.
 * Returns whether it was sent.
 */
export async function sendPrivateNotice(fromPersonId: string, toPersonId: string, body: string): Promise<boolean> {
  return (await sendPrivateNoticeId(fromPersonId, toPersonId, body)) !== null;
}

/** The same, returning the message's id (null when it could not be sent). */
export async function sendPrivateNoticeId(fromPersonId: string, toPersonId: string, body: string): Promise<string | null> {
  if (fromPersonId === toPersonId) return null;
  try {
    const conversation = await getOrCreatePrivateConversation(toPersonId, { type: 'PERSON', personId: fromPersonId });
    const message = await prisma.privateMessage.create({ data: { conversationId: conversation.id, senderPersonId: fromPersonId, body } });
    await notifyPrivateMessageReceived(conversation, { type: 'PERSON', personId: fromPersonId }).catch(() => {});
    return message.id;
  } catch (err) {
    console.error('[privateNotice] could not send', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export const isFrench = (language: string | null | undefined): boolean => String(language ?? '').toLowerCase().startsWith('fr');

/** Preferred language of several people at once. */
export async function languagesOf(personIds: string[]): Promise<Map<string, string | null>> {
  const rows = await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, preferredLanguage: true } });
  return new Map(rows.map((r) => [r.id, r.preferredLanguage as string | null]));
}
