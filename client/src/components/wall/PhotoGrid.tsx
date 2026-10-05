import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface WallPhoto {
  id: string;
  postId: string;
  url: string;
}

// The "Photos" tab of a profile wall: every photo the person posted in
// Updates, as a tidy square grid. Tap one to see it big.
export function PhotoGrid({ personId }: { personId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<WallPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<WallPhoto | null>(null);

  useEffect(() => {
    setItems(null);
    setFailed(false);
    api
      .get<{ items: WallPhoto[] }>(`/api/updates/photo-wall?authorPersonId=${encodeURIComponent(personId)}`)
      .then((r) => setItems(r.items))
      .catch(() => setFailed(true));
  }, [personId]);

  if (failed) return <p className="card text-sm text-red-700">{t('wall.photos_failed')}</p>;
  if (items === null) return <p className="py-6 text-center text-sm text-slate-400">{t('wall.loading')}</p>;
  if (items.length === 0) return <p className="card text-center text-sm text-slate-500">{t('wall.no_photos')}</p>;

  return (
    <>
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl">
        {items.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p)} className="aspect-square overflow-hidden bg-slate-200" aria-label={t('wall.open_photo') ?? ''}>
            <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-label={t('wall.photo') ?? ''} className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex justify-end p-3">
            <button type="button" onClick={() => setOpen(null)} aria-label={t('wall.close') ?? ''} className="text-2xl text-white">
              ✕
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto">
            <img src={open.url} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

// Simple tabs used on profile walls.
export function WallTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="sticky top-[57px] z-[5] flex border-b border-slate-200 bg-white">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 border-b-2 py-3 text-sm font-semibold ${value === tab.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
