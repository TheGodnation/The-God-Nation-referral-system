import { MAX_MESSAGE_CHARS } from './textLimits';
import { z } from 'zod';

// WhatsApp-style message actions shared by group and private chats.

// "Edit" is allowed for 15 minutes after sending, like WhatsApp.
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
// "Delete for everyone" is allowed for 2 days after sending, like WhatsApp.
export const UNSEND_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

// 65536 matches the message-creation cap (WhatsApp's own limit — see
// communityConversations.ts/privateMessages.ts) — a long message must stay
// editable within the same bound it was allowed to be sent at.
export const editMessageSchema = z.object({
  body: z.string().trim().min(1, 'A message cannot be empty.').max(MAX_MESSAGE_CHARS),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

// Forwarding: up to 5 chats at once, like WhatsApp.
export const MAX_FORWARD_TARGETS = 5;
