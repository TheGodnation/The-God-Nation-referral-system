import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError } from './api';
import type { ChatMessage, ChatReaction } from '../components/chat/types';
import type { OutgoingMessage } from '../components/chat/ChatComposer';

// Helpers that keep the chats light on slow / expensive networks:
//  - ask only for NEW messages (plus a tiny list of recent changes),
//  - check less often when the chat is quiet,
//  - keep messages typed while offline and send them when the network
//    comes back (WhatsApp's 🕓 clock).

export interface RecentChange {
  id: string;
  deleted?: boolean;
  reactions?: ChatReaction[];
  status?: 'sent' | 'delivered' | 'read';
}

/** Adds newly arrived messages after what we already have (no repeats);
 * messages still being sent stay at the end. */
export function appendNew(prev: ChatMessage[], items: ChatMessage[]): ChatMessage[] {
  const pending = prev.filter((m) => m.pending);
  const known = new Set(prev.filter((m) => !m.pending).map((m) => m.id));
  const fresh = items.filter((m) => !known.has(m.id));
  return [...prev.filter((m) => !m.pending), ...fresh, ...pending];
}

/** Applies ticks / reactions / removals reported for recent messages. */
export function applyRecent(prev: ChatMessage[], recent: RecentChange[] | undefined): ChatMessage[] {
  if (!recent || recent.length === 0) return prev;
  const byId = new Map(recent.map((r) => [r.id, r]));
  let changed = false;
  const next = prev.map((m) => {
    const r = byId.get(m.id);
    if (!r) return m;
    const updated: ChatMessage = {
      ...m,
      reactions: r.reactions ?? m.reactions,
      status: r.status ?? m.status,
      ...(r.deleted && !m.deleted ? { deleted: true, body: null, attachments: [], replyTo: null, reactions: [] } : {}),
    };
    if (
      updated.status !== m.status ||
      updated.deleted !== m.deleted ||
      JSON.stringify(updated.reactions ?? []) !== JSON.stringify(m.reactions ?? [])
    ) {
      changed = true;
      return updated;
    }
    return m;
  });
  return changed ? next : prev;
}

/** The id of the newest message we have from the server (not a pending one). */
export function lastServerId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].pending) return messages[i].id;
  return null;
}

/**
 * Calls `poll` every `baseMs` while something is happening, and slows
 * down (up to every 30 s) while the chat is quiet. `poll` returns true when
 * something happened (new message, someone typing). Only polls while the
 * screen is visible; polls straight away when the screen comes back.
 * Returns `poke()` to poll now and go back to the fast pace.
 */
export function useAdaptivePoll(poll: () => Promise<boolean>, baseMs: number, enabled = true) {
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const delay = useRef(baseMs);
  const timer = useRef<number | null>(null);
  const running = useRef(false);

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(tick, delay.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tick = useCallback(async () => {
    if (running.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      schedule();
      return;
    }
    running.current = true;
    let active = false;
    try {
      active = await pollRef.current();
    } catch {
      active = false;
    }
    running.current = false;
    delay.current = active ? baseMs : Math.min(30000, Math.round(delay.current * 1.6));
    schedule();
  }, [baseMs, schedule]);

  const poke = useCallback(() => {
    delay.current = baseMs;
    void tick();
  }, [baseMs, tick]);

  useEffect(() => {
    if (!enabled) return;
    delay.current = baseMs;
    schedule();
    const onVisible = () => document.visibilityState === 'visible' && poke();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, baseMs, schedule, poke]);

  return poke;
}

interface QueuedItem {
  tempId: string;
  out: OutgoingMessage;
  message: ChatMessage;
}

function readOutbox(key: string): QueuedItem[] {
  try {
    const raw = localStorage.getItem(`outbox:${key}`);
    return raw ? (JSON.parse(raw) as QueuedItem[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(key: string, items: QueuedItem[]) {
  try {
    if (items.length) localStorage.setItem(`outbox:${key}`, JSON.stringify(items));
    else localStorage.removeItem(`outbox:${key}`);
  } catch {
    /* ignore */
  }
}

/**
 * Messages typed while the network was down. They show with a 🕓 and are
 * sent by themselves when the network comes back (also after reopening
 * the app). `send` posts one message; `onSent` / `onRefused` report back.
 */
export function useOutbox(
  chatKey: string,
  send: (out: OutgoingMessage) => Promise<void>,
  onSent: (tempId: string) => void,
  onRefused: (tempId: string, err: unknown) => void,
) {
  const [queued, setQueued] = useState<QueuedItem[]>(() => readOutbox(chatKey));
  const queueRef = useRef(queued);
  queueRef.current = queued;
  const flushing = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  const onRefusedRef = useRef(onRefused);
  onRefusedRef.current = onRefused;

  const update = useCallback(
    (items: QueuedItem[]) => {
      queueRef.current = items;
      setQueued(items);
      writeOutbox(chatKey, items);
    },
    [chatKey],
  );

  const flush = useCallback(async () => {
    if (flushing.current || queueRef.current.length === 0) return;
    flushing.current = true;
    try {
      for (const item of [...queueRef.current]) {
        try {
          await sendRef.current(item.out);
          update(queueRef.current.filter((q) => q.tempId !== item.tempId));
          onSentRef.current(item.tempId);
        } catch (err) {
          if (err instanceof NetworkError) break; // still offline — try later
          update(queueRef.current.filter((q) => q.tempId !== item.tempId));
          onRefusedRef.current(item.tempId, err instanceof ApiError ? err : null);
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [update]);

  const enqueue = useCallback(
    (tempId: string, out: OutgoingMessage, message: ChatMessage) => {
      update([...queueRef.current, { tempId, out, message: { ...message, pending: true, queued: true } }]);
    },
    [update],
  );

  useEffect(() => {
    const onBack = () => void flush();
    const onReach = (e: Event) => (e as CustomEvent<boolean>).detail && void flush();
    window.addEventListener('online', onBack);
    window.addEventListener('api-reachable', onReach);
    const timer = window.setInterval(() => queueRef.current.length && void flush(), 15000);
    void flush();
    return () => {
      window.removeEventListener('online', onBack);
      window.removeEventListener('api-reachable', onReach);
      window.clearInterval(timer);
    };
  }, [flush]);

  return { queued, enqueue };
}
