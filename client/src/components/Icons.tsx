// Small, hand-authored inline SVG icons — used instead of image files or
// emoji/dingbats so the site never depends on an external asset request or
// a font's emoji rendering (which varies across devices). Each accepts a
// className so callers control size/color via Tailwind (most use
// `currentColor` for stroke/fill, so `text-*` classes work directly).

type IconProps = { className?: string };

export function GraduationCapIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5" />
      <path d="M22 10v6" />
    </svg>
  );
}

export function HeartHandsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5s-7-4.35-9.5-8.8C1 8.6 2.6 5.5 5.7 5c1.9-.3 3.6.6 4.6 2.1a.8.8 0 0 0 1.4 0C12.7 5.6 14.4 4.7 16.3 5c3.1.5 4.7 3.6 3.2 6.7-2.5 4.45-9.5 8.8-9.5 8.8Z" />
    </svg>
  );
}

export function CompassIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-2 6-6 2 2-6 6-2Z" />
    </svg>
  );
}

export function FormIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

export function ChatHeartIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}

export function OpenBookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5.5c2.5-1.3 5.2-1.3 7.5 0v13c-2.3-1.3-5-1.3-7.5 0v-13Z" />
      <path d="M22 5.5c-2.5-1.3-5.2-1.3-7.5 0v13c2.3-1.3 5-1.3 7.5 0v-13Z" />
    </svg>
  );
}

export function SunriseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v5" />
      <path d="m5.6 8.6 1.4 1.4" />
      <path d="m17 10 1.4-1.4" />
      <path d="M3 17h18" />
      <path d="M5 17a7 7 0 0 1 14 0" />
      <path d="M2 21h20" />
    </svg>
  );
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.35 2 11.7c0 1.86.55 3.6 1.5 5.08L2 22l5.4-1.42a10.2 10.2 0 0 0 4.6 1.12c5.52 0 10-4.35 10-9.7C22 6.35 17.52 2 12 2Zm0 17.6c-1.5 0-2.94-.4-4.2-1.15l-.3-.18-3.2.84.86-3.1-.2-.32A7.9 7.9 0 0 1 4 11.7c0-4.35 3.6-7.9 8-7.9s8 3.55 8 7.9-3.6 7.9-8 7.9Zm4.4-5.9c-.24-.12-1.44-.7-1.66-.78-.22-.08-.38-.12-.55.12-.16.24-.63.78-.77.94-.14.16-.28.18-.52.06-.24-.12-1-.37-1.9-1.17-.7-.63-1.18-1.4-1.32-1.64-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.8-.2-.48-.4-.4-.55-.4-.14 0-.3-.02-.46-.02s-.42.06-.64.3c-.22.24-.85.83-.85 2.02 0 1.2.87 2.35.99 2.51.12.16 1.71 2.6 4.14 3.65.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

export function TelegramIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.9 4.6 18.7 20c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9L18 7c.4-.4-.1-.6-.6-.2L6.5 13.6l-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3.4c.9-.3 1.6.2 1.3 1.2Z" />
    </svg>
  );
}

export function MessengerIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.5 2 2 6.1 2 11.3c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.25 1.9.4 2.9.4 5.5 0 10-4.1 10-9.3S17.5 2 12 2Zm1 12.5-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 5-2.7-5.5 5.8Z" />
    </svg>
  );
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.16 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.5 1.49-3.89 3.77-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.78 8.44-4.94 8.44-9.94Z" />
    </svg>
  );
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TikTokIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.6 2h-3.2v13.9a2.8 2.8 0 1 1-2-2.68V9.9a6 6 0 1 0 5.2 5.95V8.4a7.9 7.9 0 0 0 4.4 1.33V6.5a4.7 4.7 0 0 1-4.4-4.5Z" />
    </svg>
  );
}

export function YouTubeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.5 7.2s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C16.4 3.6 12 3.6 12 3.6h0s-4.4 0-7.3.3c-.4 0-1.4.1-2.3 1-.7.7-.9 2.3-.9 2.3S1.2 9 1.2 10.9v2c0 1.9.3 3.7.3 3.7s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.1.3 7.1.3s4.4 0 7.3-.3c.4 0 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.3-1.9.3-3.7v-2c0-1.9-.3-3.7-.3-3.7ZM9.7 14.8V8.9l5.6 3-5.6 2.9Z" />
    </svg>
  );
}
