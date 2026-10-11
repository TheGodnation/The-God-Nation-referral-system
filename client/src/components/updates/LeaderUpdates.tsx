import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UpdatesFeed } from './UpdatesFeed';

// Leader dashboard: the community Updates feed, folded by default so the
// dashboard stays short. Assigned leaders can delete posts and comments
// that break the community rules (the server decides who may).
export function LeaderUpdates() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-brand-900">{t('updates.title')}</h2>
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('updates.hide') : t('updates.show')}
        </button>
      </div>
      {open && (
        <div className="mt-4">
          <UpdatesFeed />
        </div>
      )}
    </div>
  );
}
