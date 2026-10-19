import { useTranslation } from 'react-i18next';

// A full-screen, Facebook-style "tap to see it big" viewer — the same
// black full-screen frame already used by the chat photo viewer and the
// wall Photos-tab grid, pulled out so a profile photo / cover photo can
// zoom the same way.
export function PhotoLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="dialog" aria-label={alt} className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex justify-end p-3">
        <button type="button" onClick={onClose} aria-label={t('wall.close') ?? ''} className="text-2xl text-white">
          ✕
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto">
        <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}
