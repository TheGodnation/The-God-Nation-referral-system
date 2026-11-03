import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublicSettings } from '../lib/usePublicSettings';
import { adsConfigured, configureAds, getAdsChoice, onAdsChoiceChange, setAdsChoice } from '../lib/adsTracking';

// Lets a visitor see and change the "ad measurement on this device" answer.
// Shown only while an ad platform is connected.
export function AdsDeviceChoice() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const [choice, setChoice] = useState(getAdsChoice);
  const [changedToNo, setChangedToNo] = useState(false);

  useEffect(() => {
    if (settings.loaded) configureAds(settings.ads);
  }, [settings.loaded, settings.ads]);
  useEffect(() => onAdsChoiceChange(() => setChoice(getAdsChoice())), []);

  if (!settings.loaded || !adsConfigured(settings.ads)) return null;

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700" data-testid="ads-device-choice">
      <p className="font-medium text-brand-900">{t('adsBanner.device_title')}</p>
      <p className="mt-1">{choice === 'yes' ? t('adsBanner.device_yes') : choice === 'no' ? t('adsBanner.device_no') : t('adsBanner.device_unset')}</p>
      <div className="mt-2 flex gap-2">
        {choice !== 'yes' && (
          <button type="button" className="btn-secondary" onClick={() => setAdsChoice('yes')}>
            {t('adsBanner.yes')}
          </button>
        )}
        {choice !== 'no' && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setAdsChoice('no');
              setChangedToNo(true);
            }}
          >
            {t('adsBanner.no')}
          </button>
        )}
      </div>
      {changedToNo && <p className="mt-2 text-xs text-slate-500" role="status">{t('adsBanner.device_reload')}</p>}
    </div>
  );
}
