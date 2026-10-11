import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { ProfileImageError, uploadAdminImage } from '../../lib/profileImages';
import { WALLPAPER_PRESETS } from '../../lib/wallpaper';

type Target = 'home' | 'chat';

// Admin: one background for everyone, for the Home page or for chats —
// either a built-in preset (no download at all) or a custom uploaded
// image. Setting one always clears the other (server-enforced too).
export function AdminWallpaperPicker({ target, title, hint }: { target: Target; title: string; hint: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ homeWallpaper?: { preset: string | null; imageUrl: string | null }; chatWallpaper?: { preset: string | null; imageUrl: string | null } }>('/api/settings/public')
      .then((r) => {
        const w = target === 'home' ? r.homeWallpaper : r.chatWallpaper;
        setPreset(w?.preset ?? null);
        setImageUrl(w?.imageUrl ?? null);
      })
      .catch(() => {});
  }
  useEffect(load, [target]);

  async function choosePreset(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/admin/wallpaper/${target}`, { preset: id });
      setPreset(id);
      setImageUrl(null);
    } catch {
      setError(t('admin.branding.wallpaper_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAdminImage(`/api/admin/wallpaper/${target}`, file, 1280);
      load();
    } catch (err) {
      const reason = err instanceof ProfileImageError ? err.reason : 'failed';
      setError(reason === 'storage' ? t('wall.storage_off') : reason === 'type' ? t('wall.wrong_type') : reason === 'size' ? t('wall.too_big') : t('admin.branding.wallpaper_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/admin/wallpaper/${target}`);
      setPreset(null);
      setImageUrl(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.branding.wallpaper_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-brand-900">🎨 {title}</h3>
      <p className="text-xs text-slate-500">{hint}</p>

      {imageUrl && (
        <div className="h-20 w-full overflow-hidden rounded-lg">
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {WALLPAPER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busy}
            onClick={() => void choosePreset(p.id)}
            className={`h-10 w-10 rounded-full border-2 ${!imageUrl && preset === p.id ? 'border-brand-600' : 'border-slate-200'}`}
            style={{ backgroundColor: p.swatch }}
            aria-label={t(`admin.branding.wallpaper_preset_${p.id}`) ?? p.id}
            title={t(`admin.branding.wallpaper_preset_${p.id}`) ?? p.id}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('wall.uploading') : t('admin.branding.wallpaper_upload')}
        </button>
        {(imageUrl || preset) && !busy && (
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => void reset()}>
            {t('admin.branding.wallpaper_reset')}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={title}
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
