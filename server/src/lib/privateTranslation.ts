import type { Language } from '@prisma/client';
import { prisma } from './prisma';
import { isTranslationConfigured, translateText } from './translation';

// Tap-to-translate for private (one-to-one) messages. Private messages are never translated by themselves: it happens
// only when someone taps "Translate", and then once: the result is stored on the message, so the other person (and
// any later tap) reads the same translation without another request to the translator.

export class PrivateTranslationError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export interface StoredTranslation {
  detectedLanguage: Language;
  translatedBody: string;
}

/** The stored translation, making it first if there is none yet. Throws PrivateTranslationError when it cannot be made. */
export async function translatePrivateMessage(messageId: string): Promise<StoredTranslation> {
  const message = await prisma.privateMessage.findUnique({ where: { id: messageId }, select: { body: true, deletedAt: true, detectedLanguage: true, translatedBody: true, translatedAt: true } });
  if (!message || message.deletedAt) throw new PrivateTranslationError('Message not found.', 404);
  if (message.translatedAt && message.detectedLanguage && message.translatedBody !== null) {
    return { detectedLanguage: message.detectedLanguage, translatedBody: message.translatedBody };
  }
  if (!message.body.trim()) throw new PrivateTranslationError('There is no text to translate.', 400);
  if (!isTranslationConfigured()) throw new PrivateTranslationError('Translation is not available right now.', 503);
  const result = await translateText(message.body);
  if (!result) throw new PrivateTranslationError('The translation could not be made right now. Please try again in a moment.', 502);
  // Stored only if nobody stored one meanwhile (two taps together make one stored copy).
  await prisma.privateMessage.updateMany({
    where: { id: messageId, translatedAt: null },
    data: { detectedLanguage: result.detectedLanguage, translatedBody: result.translatedBody, translatedAt: new Date() },
  });
  const saved = await prisma.privateMessage.findUnique({ where: { id: messageId }, select: { detectedLanguage: true, translatedBody: true } });
  return { detectedLanguage: saved?.detectedLanguage ?? result.detectedLanguage, translatedBody: saved?.translatedBody ?? result.translatedBody };
}

/** What the reader sees: the translation only when the message is in the other language. */
export function translationFor(m: { deletedAt: Date | null; detectedLanguage: Language | null; translatedBody: string | null }, viewerLanguage: Language | null) {
  if (m.deletedAt || !m.detectedLanguage || !viewerLanguage || m.detectedLanguage === viewerLanguage || !m.translatedBody) return null;
  return { sourceLanguage: m.detectedLanguage, translatedBody: m.translatedBody };
}
