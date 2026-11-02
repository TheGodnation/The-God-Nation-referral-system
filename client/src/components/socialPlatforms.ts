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
  whatsappGroupEnUrl?: string | null;
  whatsappGroupFrUrl?: string | null;
  telegramUrl: string | null;
  messengerUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
}

export interface SocialLink {
  /** Used for the About page wording (aboutGodNation.social_<key>). */
  key: string;
  label: string;
  url: string;
  /** Which brand icon (a key of SOCIAL_ICONS). */
  icon: string;
}

/**
 * The places that have a link (the admin chooses which), in a fixed order: the two WhatsApp groups first.
 * Only groups and public pages: the ministry's personal WhatsApp contact is the Assistance button on the Chats page.
 */
export function configuredSocials(s: SocialUrls): SocialLink[] {
  return [
    { url: s.whatsappGroupEnUrl, key: 'whatsapp_en', label: 'WhatsApp (English)', icon: 'WhatsApp' },
    { url: s.whatsappGroupFrUrl, key: 'whatsapp_fr', label: 'WhatsApp (French)', icon: 'WhatsApp' },
    { url: s.telegramUrl, key: 'telegram', label: 'Telegram', icon: 'Telegram' },
    { url: s.messengerUrl, key: 'messenger', label: 'Messenger', icon: 'Messenger' },
    { url: s.facebookUrl, key: 'facebook', label: 'Facebook', icon: 'Facebook' },
    { url: s.instagramUrl, key: 'instagram', label: 'Instagram', icon: 'Instagram' },
    { url: s.tiktokUrl, key: 'tiktok', label: 'TikTok', icon: 'TikTok' },
    { url: s.youtubeUrl, key: 'youtube', label: 'YouTube', icon: 'YouTube' },
  ].filter((x): x is SocialLink => Boolean(x.url));
}
