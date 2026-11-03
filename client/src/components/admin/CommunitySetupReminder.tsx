import { useTranslation } from 'react-i18next';
import { configuredSocials } from '../socialPlatforms';
import { usePublicSettings } from '../../lib/usePublicSettings';

// Every place people can choose to join or follow, with the name shown to the admin.
export const ALL_PLACES: { platform: string; label: string; kind: 'community' | 'follow' }[] = [
  { platform: 'whatsapp_group_en', label: 'WhatsApp group (English)', kind: 'community' },
  { platform: 'whatsapp_group_fr', label: 'WhatsApp group (French)', kind: 'community' },
  { platform: 'whatsapp_channel', label: 'WhatsApp channel', kind: 'community' },
  { platform: 'telegram_group', label: 'Telegram group', kind: 'community' },
  { platform: 'telegram_channel', label: 'Telegram channel', kind: 'community' },
  { platform: 'messenger', label: 'Messenger group or community', kind: 'community' },
  { platform: 'facebook_group', label: 'Facebook group', kind: 'community' },
  { platform: 'facebook', label: 'Facebook page', kind: 'follow' },
  { platform: 'instagram', label: 'Instagram', kind: 'follow' },
  { platform: 'tiktok', label: 'TikTok', kind: 'follow' },
  { platform: 'youtube', label: 'YouTube', kind: 'follow' },
];

/** The places that still have no link. */
export function missingPlaces(settings: Parameters<typeof configuredSocials>[0]) {
  const have = new Set(configuredSocials(settings).map((s) => s.platform));
  return ALL_PLACES.filter((p) => !have.has(p.platform));
}

// A standing reminder for the central admin: which groups, channels and pages
// are still to be created, and where to paste each link. It disappears by
// itself once every place has a link.
export function CommunitySetupReminder() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  if (!settings.loaded) return null;
  const missing = missingPlaces(settings);
  if (missing.length === 0) return null;
  const community = missing.filter((m) => m.kind === 'community');
  const follow = missing.filter((m) => m.kind === 'follow');
  return (
    <div className="card border-l-4 border-amber-400 bg-amber-50 text-sm text-amber-900" role="note" data-testid="setup-reminder">
      <p className="font-semibold">{t('growth.setup_title')}</p>
      <p className="mt-1 text-xs">{t('growth.setup_body')}</p>
      {community.length > 0 && (
        <p className="mt-2">
          <span className="font-medium">{t('growth.setup_community')}</span> {community.map((m) => m.label).join(' · ')}
        </p>
      )}
      {follow.length > 0 && (
        <p className="mt-1">
          <span className="font-medium">{t('growth.setup_follow')}</span> {follow.map((m) => m.label).join(' · ')}
        </p>
      )}
      <p className="mt-2 text-xs">
        {t('growth.setup_where')}{' '}
        <a href="/admin/dashboard" className="font-semibold underline">{t('growth.setup_link')}</a>
      </p>
    </div>
  );
}
