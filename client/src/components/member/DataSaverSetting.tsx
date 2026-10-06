import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDataSaverSetting, setDataSaverSetting, type DataSaverSetting as Setting } from '../../lib/dataSaver';

// "📶 Save data": choose whether photos, videos and voice notes download by
// themselves or only when tapped. Stored on this phone only.
export function DataSaverSetting() {
  const { t } = useTranslation();
  const [value, setValue] = useState<Setting>(getDataSaverSetting);
  const options: { id: Setting; label: string; hint: string }[] = [
    { id: 'auto', label: t('network.saver_auto'), hint: t('network.saver_auto_hint') },
    { id: 'on', label: t('network.saver_on'), hint: t('network.saver_on_hint') },
    { id: 'off', label: t('network.saver_off'), hint: t('network.saver_off_hint') },
  ];
  return (
    <fieldset className="card mt-4 space-y-2">
      <legend className="sr-only">{t('network.saver_title')}</legend>
      <p className="font-semibold text-brand-900">📶 {t('network.saver_title')}</p>
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
          <input
            type="radio"
            name="data-saver"
            className="mt-1"
            checked={value === o.id}
            onChange={() => {
              setValue(o.id);
              setDataSaverSetting(o.id);
            }}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">{o.label}</span>
            <span className="block text-xs text-slate-500">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
