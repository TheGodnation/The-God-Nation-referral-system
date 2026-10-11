// One light chat wallpaper for all chats (like WhatsApp's doodle
// background): a tiny drawn pattern — small crosses, hearts and dots — kept
// inside the app itself, so it costs no download at all.
const PATTERN = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='none' stroke='%23122a78' stroke-opacity='0.07' stroke-width='2' stroke-linecap='round'><path d='M20 12v16M12 20h16'/><path d='M84 70c0-5 7-7 9-2 2-5 9-3 9 2 0 6-9 11-9 11s-9-5-9-11z'/><path d='M70 22l6 6m0-6l-6 6'/><path d='M22 86v14M15 93h14'/></g><g fill='%23122a78' fill-opacity='0.06'><circle cx='100' cy='18' r='3'/><circle cx='54' cy='104' r='3'/><circle cx='48' cy='52' r='2'/></g></svg>`;

export const CHAT_WALLPAPER_STYLE = {
  backgroundColor: '#efeae2',
  backgroundImage: `url("data:image/svg+xml;utf8,${PATTERN}")`,
  backgroundSize: '120px 120px',
} as const;
