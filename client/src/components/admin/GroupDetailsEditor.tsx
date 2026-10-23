import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { ProfileImageError, uploadAdminImage } from '../../lib/profileImages';

// Admin: a group's picture and its purpose / vision text (English and
// French), shown to members in the chat list, the chat and the group info
// page. Only the admin can change these.
export function GroupDetailsEditor({ communityId, communityName }: { communityId: string; communityName: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [aboutEn, setAboutEn] = useState('');
  const [aboutFr, setAboutFr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/admin/communities/${communityId}`;

  function load() {
    api
      .get<{ photoUrl: string | null; aboutEn: string | null; aboutFr: string | null }>(`${base}/details`)
      .then((r) => {
        setPhotoUrl(r.photoUrl);
        setAboutEn(r.aboutEn ?? '');
        setAboutFr(r.aboutFr ?? '');
      })
      .catch(() => setError(t('admin.branding.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [communityId]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAdminImage(`${base}/photo`, file, 512);
      load();
    } catch (err) {
      const reason = err instanceof ProfileImageError ? err.reason : 'failed';
      setError(reason === 'storage' ? t('wall.storage_off') : reason === 'type' ? t('wall.wrong_type') : reason === 'size' ? t('wall.too_big') : t('wall.upload_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await api.delete(`${base}/photo`);
      setPhotoUrl(null);
    } catch {
      setError(t('wall.upload_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveAbout(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.patch(`${base}/about`, { aboutEn, aboutFr });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.branding.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg bg-slate-50 p-4">
      <h4 className="font-semibold text-brand-900">{t('admin.branding.group_title', { name: communityName })}</h4>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-2xl">
          {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : '👥'}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? t('wall.uploading') : photoUrl ? t('admin.branding.change_picture') : t('admin.branding.add_picture')}
          </button>
          {photoUrl && !busy && (
            <button type="button" className="text-sm text-slate-500 underline" onClick={() => void removePhoto()}>
              {t('wall.remove')}
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={t('admin.branding.group_picture') ?? ''}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <form onSubmit={saveAbout} className="space-y-3">
        <p className="text-xs text-slate-500">{t('admin.branding.about_hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">{t('admin.branding.about_en')}</span>
            <textarea className="input min-h-[90px]" maxLength={1500} value={aboutEn} onChange={(e) => setAboutEn(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t('admin.branding.about_fr')}</span>
            <textarea className="input min-h-[90px]" maxLength={1500} value={aboutFr} onChange={(e) => setAboutFr(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary px-4 py-1.5 text-sm" disabled={busy}>
            {t('admin.branding.save')}
          </button>
          {saved && <span className="text-sm text-green-700">{t('admin.branding.saved')}</span>}
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
