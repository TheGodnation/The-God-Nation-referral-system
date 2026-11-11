import { isTranslationConfigured, translateText } from './translation';
import { MAX_MESSAGE_CHARS } from './textLimits';
import { BroadcastError } from './leaderBroadcast';

/**
 * The preview step of "write to many people": the text is translated once (English <-> French) so the sender can read and
 * correct both versions before anything is sent. Nothing is stored here; what is sent is what the sender confirms.
 */
export async function previewTranslation(text: string): Promise<{ detectedLanguage: 'en' | 'fr'; translatedBody: string }> {
  const trimmed = text.trim();
  if (!trimmed) throw new BroadcastError('Write a message first.');
  if (trimmed.length > MAX_MESSAGE_CHARS) throw new BroadcastError('The message is too long.');
  if (!isTranslationConfigured()) throw new BroadcastError('Translation is not available right now.', 503);
  const result = await translateText(trimmed);
  if (!result) throw new BroadcastError('The translation could not be made right now. Please try again in a moment.', 502);
  return { detectedLanguage: result.detectedLanguage, translatedBody: result.translatedBody };
}
