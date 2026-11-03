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
  whatsappChannelUrl?: string | null;
  telegramGroupUrl?: string | null;
  /** The Telegram channel. */
  telegramUrl: string | null;
  /** The Messenger group or community. */
  messengerUrl: string | null;
  facebookGroupUrl?: string | null;
  /** The Facebook page. */
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
  /** The name used when a tap is counted (the server's list in lib/communityPlatforms.ts). */
  platform: string;
  /** "community" places are where people meet (groups, channels); "follow" places are public pages. */
  kind: 'community' | 'follow';
}

/**
 * Every place that has a link (the admin chooses which), in a fixed order: the groups and channels where
 * people meet first, then the public pages. Only groups, channels and pages: the ministry's personal
 * WhatsApp contact is the Assistance button on the Chats page.
 */
export function configuredSocials(s: SocialUrls): SocialLink[] {
  const all: (Omit<SocialLink, 'url'> & { url?: string | null })[] = [
    { url: s.whatsappGroupEnUrl, key: 'whatsapp_en', label: 'WhatsApp (English)', icon: 'WhatsApp', platform: 'whatsapp_group_en', kind: 'community' },
    { url: s.whatsappGroupFrUrl, key: 'whatsapp_fr', label: 'WhatsApp (French)', icon: 'WhatsApp', platform: 'whatsapp_group_fr', kind: 'community' },
    { url: s.whatsappChannelUrl, key: 'whatsapp_channel', label: 'WhatsApp channel', icon: 'WhatsApp', platform: 'whatsapp_channel', kind: 'community' },
    { url: s.telegramGroupUrl, key: 'telegram_group', label: 'Telegram group', icon: 'Telegram', platform: 'telegram_group', kind: 'community' },
    { url: s.telegramUrl, key: 'telegram', label: 'Telegram channel', icon: 'Telegram', platform: 'telegram_channel', kind: 'community' },
    { url: s.messengerUrl, key: 'messenger', label: 'Messenger', icon: 'Messenger', platform: 'messenger', kind: 'community' },
    { url: s.facebookGroupUrl, key: 'facebook_group', label: 'Facebook group', icon: 'Facebook', platform: 'facebook_group', kind: 'community' },
    { url: s.facebookUrl, key: 'facebook', label: 'Facebook', icon: 'Facebook', platform: 'facebook', kind: 'follow' },
    { url: s.instagramUrl, key: 'instagram', label: 'Instagram', icon: 'Instagram', platform: 'instagram', kind: 'follow' },
    { url: s.tiktokUrl, key: 'tiktok', label: 'TikTok', icon: 'TikTok', platform: 'tiktok', kind: 'follow' },
    { url: s.youtubeUrl, key: 'youtube', label: 'YouTube', icon: 'YouTube', platform: 'youtube', kind: 'follow' },
  ];
  return all.filter((x): x is SocialLink => Boolean(x.url));
}

/** The places to join, with the WhatsApp group in the person's own language first. */
export function communityPlaces(s: SocialUrls, lang: 'en' | 'fr'): SocialLink[] {
  const places = configuredSocials(s).filter((x) => x.kind === 'community');
  const mine = lang === 'fr' ? 'whatsapp_fr' : 'whatsapp_en';
  return [...places.filter((x) => x.key === mine), ...places.filter((x) => x.key !== mine)];
}

export function followPlaces(s: SocialUrls): SocialLink[] {
  return configuredSocials(s).filter((x) => x.kind === 'follow');
}
