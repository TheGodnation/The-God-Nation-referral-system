import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublicSettings } from '../../lib/usePublicSettings';
import { useDataSaver } from '../../lib/dataSaver';

function MvpBox({ icon, title, text }: { icon: string; title: string; text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <p className="text-sm font-bold text-brand-900">
        {icon} {title}
      </p>
      <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 ${long && !open ? 'line-clamp-3' : ''}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-semibold text-brand-700">
          {open ? t('updates.see_less') : t('updates.see_more')}
        </button>
      )}
    </div>
  );
}

// The top of the member Updates page: the ministry's banner picture (set
// by the admin), its slogan, and short Mission / Vision / Purpose boxes.
// Light: the picture is shrunk on upload and kept by the phone; with "Save
// data" on, a coloured background is shown instead.
export function UpdatesBanner() {
  const { t, i18n } = useTranslation();
  const { content, appBannerUrl, loaded } = usePublicSettings();
  const saver = useDataSaver();
  const [failed, setFailed] = useState(false);
  const lang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const text = (key: string) => (content[`${key}${lang}`] || content[`${key}En`] || '').trim();

  if (!loaded) return null;
  const slogan = text('appSlogan');
  const boxes = [
    { key: 'appMission', icon: '📌', title: t('updates.mission') },
    { key: 'appVision', icon: '👁', title: t('updates.vision') },
    { key: 'appPurpose', icon: '🎯', title: t('updates.purpose') },
  ].filter((b) => text(b.key));

  const showPicture = appBannerUrl && !failed && !saver;

  return (
    <section aria-label={t('updates.banner_label') ?? ''} className="space-y-2">
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-brand-800 via-brand-600 to-amber-500 sm:h-52 sm:rounded-xl">
        {showPicture && (
          <img src={appBannerUrl!} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
          <img src="/icons/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-0.5 shadow" />
          <div className="min-w-0 text-white">
            <p className="text-lg font-bold leading-tight drop-shadow">THE GOD NATION</p>
            {slogan && <p className="text-sm leading-snug text-white/90 drop-shadow">{slogan}</p>}
          </div>
        </div>
      </div>
      {boxes.length > 0 && (
        <div className={`grid gap-2 px-4 sm:px-0 ${boxes.length > 1 ? 'sm:grid-cols-3' : ''}`}>
          {boxes.map((b) => (
            <MvpBox key={b.key} icon={b.icon} title={b.title} text={text(b.key)} />
          ))}
        </div>
      )}
    </section>
  );
}
