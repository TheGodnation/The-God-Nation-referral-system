import { z } from 'zod';

// WhatsApp-style message actions shared by group and private chats.

// "Edit" is allowed for 15 minutes after sending, like WhatsApp.
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
// "Delete for everyone" is allowed for 2 days after sending, like WhatsApp.
export const UNSEND_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export const editMessageSchema = z.object({
  body: z.string().trim().min(1, 'A message cannot be empty.').max(2000),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export const muteSchema = z.object({
  for: z.enum(['8h', '1w', 'always']),
});

export function muteUntil(choice: '8h' | '1w' | 'always', now = Date.now()): Date | null {
  if (choice === '8h') return new Date(now + 8 * 60 * 60 * 1000);
  if (choice === '1w') return new Date(now + 7 * 24 * 60 * 60 * 1000);
  return null;
}

// Forwarding: up to 5 chats at once, like WhatsApp.
export const MAX_FORWARD_TARGETS = 5;
