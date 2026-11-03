// Builds the tagged links the growth report reads (utm_source, utm_medium,
// utm_campaign, utm_content, lang), and the "dynamic" parameter strings that Meta,
// TikTok and Google fill in themselves for every ad.

export type Destination = 'home' | 'join';
export type Preset = 'facebook' | 'instagram' | 'tiktok' | 'google' | 'whatsapp' | 'telegram' | 'email' | 'other';

export const DESTINATION_PATHS: Record<Destination, string> = { home: '/', join: '/member/join' };

export const PRESETS: Record<Preset, { source: string; medium: string }> = {
  facebook: { source: 'facebook', medium: 'paid' },
  instagram: { source: 'instagram', medium: 'paid' },
  tiktok: { source: 'tiktok', medium: 'paid' },
  google: { source: 'google', medium: 'cpc' },
  whatsapp: { source: 'whatsapp', medium: 'social' },
  telegram: { source: 'telegram', medium: 'social' },
  email: { source: 'email', medium: 'email' },
  other: { source: '', medium: '' },
};

/** The placeholders each ad platform replaces with the real campaign and ad name. */
export const DYNAMIC: Partial<Record<Preset, { campaign: string; content: string }>> = {
  facebook: { campaign: '{{campaign.name}}', content: '{{ad.name}}' },
  instagram: { campaign: '{{campaign.name}}', content: '{{ad.name}}' },
  tiktok: { campaign: '__CAMPAIGN_NAME__', content: '__CID__' },
  google: { campaign: '{campaignid}', content: '{creative}' },
};

/** Lower case, spaces to dashes, only letters, digits, dash, underscore and dot. */
export function slug(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export interface LinkInput {
  origin: string;
  destination: Destination;
  preset: Preset;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  lang: '' | 'en' | 'fr';
}

export interface BuiltLink {
  /** A normal link, ready to paste anywhere (a post, a WhatsApp message, a bio). */
  link: string;
  /** For ad platforms: the end of the link, with the platform's own placeholders. Empty when the platform has none. */
  dynamicParams: string;
  /** The same, as a full link. */
  dynamicLink: string;
}

function queryOf(pairs: [string, string][]): string {
  return pairs
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function buildLink(i: LinkInput): BuiltLink {
  const base = `${i.origin.replace(/\/+$/, '')}${DESTINATION_PATHS[i.destination]}`;
  const source = slug(i.source);
  const medium = slug(i.medium);
  const campaign = slug(i.campaign);
  const content = slug(i.content);
  const lang = i.lang;
  const enc = (v: string) => encodeURIComponent(v);
  const link = `${base}?${queryOf([['utm_source', enc(source)], ['utm_medium', enc(medium)], ['utm_campaign', enc(campaign)], ['utm_content', enc(content)], ['lang', lang]])}`;
  const dyn = DYNAMIC[i.preset];
  const dynamicParams = dyn ? queryOf([['utm_source', enc(source)], ['utm_medium', enc(medium)], ['utm_campaign', dyn.campaign], ['utm_content', dyn.content], ['lang', lang]]) : '';
  return { link: link.replace(/\?$/, ''), dynamicParams, dynamicLink: dyn ? `${base}?${dynamicParams}` : '' };
}
