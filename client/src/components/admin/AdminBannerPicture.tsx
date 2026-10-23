import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { ProfileImageError, uploadAdminImage } from '../../lib/profileImages';

// Admin: the picture at the top of the member Updates page (the ministry's
// banner). Its slogan and Mission / Vision / Purpose texts are edited just
// below, with the other site texts.
export function AdminBannerPicture() {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ appBannerUrl?: string | null }>('/api/settings/public')
      .then((r) => setUrl(r.appBannerUrl ?? null))
      .catch(() => {});
  }
  useEffect(load, []);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAdminImage('/api/admin/app-banner', file, 1280);
      load();
    } catch (err) {
      const reason = err instanceof ProfileImageError ? err.reason : 'failed';
      setError(reason === 'storage' ? t('wall.storage_off') : reason === 'type' ? t('wall.wrong_type') : reason === 'size' ? t('wall.too_big') : t('wall.upload_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete('/api/admin/app-banner');
      setUrl(null);
    } catch {
      setError(t('wall.upload_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-brand-900">🖼️ {t('admin.branding.banner_title')}</h3>
      <p className="text-xs text-slate-500">{t('admin.branding.banner_hint')}</p>
      <div className="h-32 overflow-hidden rounded-lg bg-gradient-to-br from-brand-800 via-brand-600 to-amber-500">
        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('wall.uploading') : url ? t('admin.branding.change_picture') : t('admin.branding.add_picture')}
        </button>
        {url && !busy && (
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => void remove()}>
            {t('wall.remove')}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t('admin.branding.banner_title') ?? ''}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
