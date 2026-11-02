import {
  WhatsAppIcon,
  TelegramIcon,
  MessengerIcon,
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  YouTubeIcon,
} from './Icons';

type IconType = (p: { className?: string }) => JSX.Element;

// One brand-appropriate icon + background color per social platform, shared by
// the public Home page and the About page.
export const SOCIAL_ICONS: Record<string, { Icon: IconType; bg: string }> = {
  WhatsApp: { Icon: WhatsAppIcon, bg: '#25D366' },
  Telegram: { Icon: TelegramIcon, bg: '#26A5E4' },
  Messenger: { Icon: MessengerIcon, bg: '#0084FF' },
  Facebook: { Icon: FacebookIcon, bg: '#1877F2' },
  Instagram: { Icon: InstagramIcon, bg: '#E1306C' },
  TikTok: { Icon: TikTokIcon, bg: '#000000' },
  YouTube: { Icon: YouTubeIcon, bg: '#FF0000' },
};

export interface SocialUrls {
  whatsappContactUrl: string | null;
  telegramUrl: string | null;
  messengerUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
}

/** The platforms that have a link (the admin chooses which), in a fixed order. */
export function configuredSocials(s: SocialUrls): { label: string; url: string }[] {
  return [
    { url: s.whatsappContactUrl, label: 'WhatsApp' },
    { url: s.telegramUrl, label: 'Telegram' },
    { url: s.messengerUrl, label: 'Messenger' },
    { url: s.facebookUrl, label: 'Facebook' },
    { url: s.instagramUrl, label: 'Instagram' },
    { url: s.tiktokUrl, label: 'TikTok' },
    { url: s.youtubeUrl, label: 'YouTube' },
  ].filter((x): x is { label: string; url: string } => Boolean(x.url));
}
