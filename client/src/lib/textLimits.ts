// How long a text may be — the same numbers as the server's
// server/src/lib/textLimits.ts. Text boxes never cut what someone types or
// pastes: past the limit they show how much is too much (LengthNote) and
// the send button waits.
export const MAX_MESSAGE_CHARS = 65536; // any chat or private message (WhatsApp's limit)
export const MAX_POST_CHARS = 63206; // a post, prayer request or announcement (Facebook's limit)
export const MAX_COMMENT_CHARS = 8000; // a comment (Facebook's limit)

export const isTooLong = (text: string, max: number) => text.trim().length > max;
