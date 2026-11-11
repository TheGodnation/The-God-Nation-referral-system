// The last messages of each private chat, kept on the phone so a chat still opens without internet (photos, voice notes and
// PDFs are kept separately, see lib/offlineStore). Small on purpose: the last 50 messages of the 20 chats used most recently,
// text only (a few hundred KB at most). Kept per member, and removed when they sign out. Best effort: if the browser refuses
// to store it, everything simply works online as before.

import type { ChatMessage } from '../components/chat/types';

export const THREAD_MESSAGES = 50;
export const THREADS_KEPT = 20;

export interface CachedThread<O = unknown> {
  other: O;
  messages: ChatMessage[];
  savedAt: number;
}

const indexKey = (ownerId: string) => `godnation:threads:${ownerId}`;
const threadKey = (ownerId: string, id: string) => `godnation:thread:${ownerId}:${id}`;
export const chatListKey = (ownerId: string) => `godnation:chatlist:${ownerId}`;

function readIndex(ownerId: string): { id: string; at: number }[] {
  try {
    const raw = localStorage.getItem(indexKey(ownerId));
    const list = raw ? (JSON.parse(raw) as { id: string; at: number }[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function put(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Keeps the latest messages of one chat (only messages the server has: not ones still waiting to be sent). */
export function saveThread<O>(ownerId: string | undefined, conversationId: string, other: O, messages: ChatMessage[]): void {
  if (!ownerId || !conversationId) return;
  const sent = messages.filter((m) => !m.pending && !m.queued && !String(m.id).startsWith('pending-')).slice(-THREAD_MESSAGES);
  if (sent.length === 0) return;
  const record: CachedThread<O> = { other, messages: sent, savedAt: Date.now() };
  const index = readIndex(ownerId).filter((e) => e.id !== conversationId);
  // The chat being saved goes first, so even on a tie of times it is never the one let go.
  index.unshift({ id: conversationId, at: record.savedAt });
  // Keep only the chats used most recently.
  index.sort((a, b) => b.at - a.at);
  for (const old of index.splice(THREADS_KEPT)) {
    try {
      localStorage.removeItem(threadKey(ownerId, old.id));
    } catch {
      /* ignore */
    }
  }
  if (!put(threadKey(ownerId, conversationId), record)) {
    // No room: let the oldest kept chat go and try once more.
    const oldest = index[index.length - 1];
    if (oldest && oldest.id !== conversationId) {
      try {
        localStorage.removeItem(threadKey(ownerId, oldest.id));
      } catch {
        /* ignore */
      }
      index.pop();
      if (!put(threadKey(ownerId, conversationId), record)) return;
    } else return;
  }
  put(indexKey(ownerId), index);
}

export function loadThread<O>(ownerId: string | undefined, conversationId: string): CachedThread<O> | null {
  if (!ownerId || !conversationId) return null;
  try {
    const raw = localStorage.getItem(threadKey(ownerId, conversationId));
    if (!raw) return null;
    const rec = JSON.parse(raw) as CachedThread<O>;
    return rec && Array.isArray(rec.messages) ? rec : null;
  } catch {
    return null;
  }
}

/** Everything kept about chats for this member (when they sign out or delete their account). */
export function clearChatCache(ownerId: string): void {
  try {
    for (const e of readIndex(ownerId)) localStorage.removeItem(threadKey(ownerId, e.id));
    localStorage.removeItem(indexKey(ownerId));
    localStorage.removeItem(chatListKey(ownerId));
  } catch {
    /* ignore */
  }
}
