// The places a person can join or follow, by the name used when a tap is
// counted. "Community" places are where people meet (groups and channels);
// "follow" places are the ministry's public pages.
export const COMMUNITY_PLATFORMS = [
  'whatsapp_group_en',
  'whatsapp_group_fr',
  'whatsapp_channel',
  'telegram_group',
  'telegram_channel',
  'messenger',
  'facebook_group',
] as const;

export const FOLLOW_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube'] as const;

export const ALL_PLATFORMS = [...COMMUNITY_PLATFORMS, ...FOLLOW_PLATFORMS] as const;
export type Platform = (typeof ALL_PLATFORMS)[number];
