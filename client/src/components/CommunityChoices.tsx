import { useTranslation } from 'react-i18next';
import { SOCIAL_ICONS, communityPlaces, followPlaces, type SocialUrls, type SocialLink } from './socialPlatforms';

// "Join us where you prefer": one button for each group or channel the ministry
// has set up (WhatsApp, Telegram, Messenger, Facebook), and the public pages to
// follow. The person taps one or several; each tap is counted through `onTap`.
export function CommunityChoices({
  settings,
  onTap,
  showFollow = true,
  titleKeyPrefix = 'joinGroup',
}: {
  settings: SocialUrls;
  onTap: (platform: string) => void;
  showFollow?: boolean;
  titleKeyPrefix?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const community = communityPlaces(settings, lang);
  const follow = showFollow ? followPlaces(settings) : [];
  if (community.length === 0 && follow.length === 0) return null;

  const row = (s: SocialLink, big: boolean) => {
    const icon = SOCIAL_ICONS[s.icon];
    return (
      <li key={s.key}>
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => onTap(s.platform)}
          data-testid={`place-${s.platform}`}
          className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white text-left font-medium text-brand-800 no-underline hover:bg-brand-50 ${big ? 'px-3 py-3' : 'px-3 py-2 text-sm'}`}
        >
          {icon && (
            <span className={`flex shrink-0 items-center justify-center rounded-full text-white ${big ? 'h-10 w-10' : 'h-8 w-8'}`} style={{ background: icon.bg }}>
              <icon.Icon className={big ? 'h-6 w-6' : 'h-4 w-4'} />
            </span>
          )}
          <span>{t(`aboutGodNation.social_${s.key}`)}</span>
        </a>
      </li>
    );
  };

  return (
    <div data-testid="community-choices">
      {community.length > 0 && <ul className="space-y-2">{community.map((s) => row(s, true))}</ul>}
      {follow.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">{t(`${titleKeyPrefix}.follow_title`)}</h3>
          <ul className="mt-2 space-y-2">{follow.map((s) => row(s, false))}</ul>
        </>
      )}
    </div>
  );
}
