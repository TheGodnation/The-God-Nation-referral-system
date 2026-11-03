import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePublicSettings } from '../lib/usePublicSettings';
import { adsConfigured, configureAds, getAdsChoice, onAdsChoiceChange, setAdsChoice } from '../lib/adsTracking';

// Asked once, on this device: may The God Nation use ad-measurement tools (Meta, TikTok,
// Google) in this browser? Shown only once an ad platform is connected in the admin
// Growth tab. Nothing from those companies loads before "Allow".
export function AdsConsentBanner() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const [choice, setChoice] = useState(getAdsChoice);

  useEffect(() => {
    if (settings.loaded) configureAds(settings.ads);
  }, [settings.loaded, settings.ads]);
  useEffect(() => onAdsChoiceChange(() => setChoice(getAdsChoice())), []);

  if (!settings.loaded || !adsConfigured(settings.ads) || choice !== null) return null;

  return (
    <div role="dialog" aria-label={t('adsBanner.title')} data-testid="ads-banner" className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white px-4 py-3 shadow-lg">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-brand-900">{t('adsBanner.title')} </span>
          {t('adsBanner.body')}{' '}
          <Link to="/privacy" className="font-medium text-brand-700 underline">
            {t('adsBanner.more')}
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-secondary" onClick={() => setAdsChoice('no')}>
            {t('adsBanner.no')}
          </button>
          <button type="button" className="btn-primary" onClick={() => setAdsChoice('yes')}>
            {t('adsBanner.yes')}
          </button>
        </div>
      </div>
    </div>
  );
}
