// How long a text may be, the same everywhere in the app (the phone's
// client/src/lib/textLimits.ts uses the same numbers):
//  - any chat or private message: 65,536 characters, WhatsApp's own limit
//  - a post (home page, announcements, headquarters posts, prayer
//    requests, teachings): 63,206 characters, Facebook's own limit
//  - a comment: 8,000 characters, also Facebook's
export const MAX_MESSAGE_CHARS = 65536;
export const MAX_POST_CHARS = 63206;
export const MAX_COMMENT_CHARS = 8000;
