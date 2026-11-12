import { configuredSocials, type SocialUrls } from '../components/socialPlatforms';

/**
 * The places a leader can send a person so they join us, in the order the founder chose: the WhatsApp group (in the
 * person's own language), the Telegram group, the Messenger group, the Facebook group, the Facebook page and the
 * Instagram page. Only the ones with a link are returned. Channels are left out on purpose.
 */
export type FollowUpId = 'whatsapp' | 'telegram_group' | 'messenger' | 'facebook_group' | 'facebook' | 'instagram' | 'website';

export interface FollowUpPlace {
  id: FollowUpId;
  url: string;
}

export function followUpPlaces(s: SocialUrls, lang: 'en' | 'fr', websiteUrl?: string): FollowUpPlace[] {
  const all = configuredSocials(s);
  const find = (key: string) => all.find((x) => x.key === key)?.url;
  // The group in their language; the other language only when that one has no link yet.
  const whatsapp = lang === 'fr' ? find('whatsapp_fr') ?? find('whatsapp_en') : find('whatsapp_en') ?? find('whatsapp_fr');
  const rows: [FollowUpId, string | undefined][] = [
    ['whatsapp', whatsapp],
    ['telegram_group', find('telegram_group')],
    ['messenger', find('messenger')],
    ['facebook_group', find('facebook_group')],
    ['facebook', find('facebook')],
    ['instagram', find('instagram')],
    // Where someone continues their study on the website (the Play Store app shows no prices or payment).
    ['website', websiteUrl],
  ];
  return rows.filter((r): r is [FollowUpId, string] => Boolean(r[1])).map(([id, url]) => ({ id, url }));
}

/** The page that opens the Leadership School on the website (after signing in with the same account). */
export function schoolWebsiteUrl(lang: 'en' | 'fr'): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/member/school${lang === 'fr' ? '?lang=fr' : ''}`;
}

/** The link that lets someone sign in with their email and then finish registering (name, country, place). */
export function finishRegistrationUrl(lang: 'en' | 'fr'): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/member/login${lang === 'fr' ? '?lang=fr' : ''}`;
}

/** A WhatsApp chat with this number, the message already typed (the leader reads it and presses send). */
export function whatsappChatUrl(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** The message text: an opening line, then one "name: link" line for each place. */
export function withLinks(opening: string, places: { label: string; url: string }[]): string {
  return [opening, ...places.map((p) => `${p.label}: ${p.url}`)].join('\n');
}
