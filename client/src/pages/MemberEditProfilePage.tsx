import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { Avatar } from '../components/Avatar';
import { DataSaverSetting } from '../components/member/DataSaverSetting';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { ProfileImageError, removeProfileImage, uploadProfileImage } from '../lib/profileImages';

const BIO_MAX = 160;

// "Edit profile": everything about the member that is NOT shown on the
// wall itself lives here — name, the short line about them, language,
// where they live, and adding/removing the two pictures.
export function MemberEditProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { member, refresh } = useMemberAuth();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'fr'>('en');
  const [locationCountry, setLocationCountry] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationArea, setLocationArea] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setBio(member.bio ?? '');
    setPreferredLanguage(member.preferredLanguage);
    setLocationCountry(member.locationCountry ?? '');
    setLocationCity(member.locationCity ?? '');
    setLocationArea(member.locationArea ?? '');
    // Only when the member first loads; later refreshes must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.personId]);

  if (!member) return null;

  function problem(err: unknown) {
    const reason = err instanceof ProfileImageError ? err.reason : 'failed';
    return reason === 'storage'
      ? t('wall.storage_off')
      : reason === 'size'
        ? t('wall.too_big')
        : reason === 'type'
          ? t('wall.wrong_type')
          : t('wall.upload_failed');
  }

  async function changeImage(kind: 'photo' | 'cover', file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(kind);
    try {
      await uploadProfileImage(kind, file);
      await refresh();
    } catch (err) {
      setError(problem(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeImage(kind: 'photo' | 'cover') {
    setError(null);
    setBusy(kind);
    try {
      await removeProfileImage(kind);
      await refresh();
    } catch {
      setError(t('wall.upload_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('wall.name_required'));
      return;
    }
    setSaving(true);
    try {
      await api.patch('/api/member/me/profile', {
        name: name.trim(),
        bio: bio.trim(),
        preferredLanguage,
        locationCountry,
        locationCity,
        locationArea,
      });
      await refresh();
      if (i18n.language.startsWith('fr') !== (preferredLanguage === 'fr')) i18n.changeLanguage(preferredLanguage);
      navigate('/member/me');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('wall.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-5 flex items-center gap-3">
          <Link to="/member/me" aria-label={t('wall.back') ?? ''} className="text-2xl leading-none text-slate-600">
            ←
          </Link>
          <h1 className="text-xl font-bold text-brand-900">{t('wall.edit_profile')}</h1>
        </div>

        <div className="card mb-4 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={member.name} photoUrl={member.photoUrl} size={64} />
            <div className="flex flex-wrap gap-2">
              <label className="btn-secondary cursor-pointer px-3 py-1.5 text-sm">
                {busy === 'photo' ? t('wall.uploading') : member.photoUrl ? t('wall.change_photo') : t('wall.add_photo')}
                <input type="file" accept="image/*" className="hidden" disabled={busy !== null} onChange={(e) => { void changeImage('photo', e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {member.photoUrl && (
                <button type="button" className="text-sm text-slate-500 underline" disabled={busy !== null} onClick={() => void removeImage('photo')}>
                  {t('wall.remove')}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="h-12 w-20 overflow-hidden rounded-md bg-gradient-to-br from-brand-700 via-brand-500 to-amber-400">
              {member.coverUrl && <img src={member.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="btn-secondary cursor-pointer px-3 py-1.5 text-sm">
                {busy === 'cover' ? t('wall.uploading') : member.coverUrl ? t('wall.change_cover') : t('wall.add_cover')}
                <input type="file" accept="image/*" className="hidden" disabled={busy !== null} onChange={(e) => { void changeImage('cover', e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {member.coverUrl && (
                <button type="button" className="text-sm text-slate-500 underline" disabled={busy !== null} onClick={() => void removeImage('cover')}>
                  {t('wall.remove')}
                </button>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={save} className="card space-y-4">
          <div>
            <label className="label" htmlFor="edit-name">{t('wall.name')}</label>
            <input id="edit-name" className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="edit-bio">{t('wall.bio')}</label>
            <textarea
              id="edit-bio"
              className="input"
              rows={2}
              maxLength={BIO_MAX}
              placeholder={t('wall.bio_placeholder') ?? ''}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {bio.length}/{BIO_MAX}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="edit-language">{t('memberDashboard.profile_language_label')}</label>
            <select id="edit-language" className="input" value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value as 'en' | 'fr')}>
              <option value="en">{t('common.language_en')}</option>
              <option value="fr">{t('common.language_fr')}</option>
            </select>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">🔒 {t('wall.private_heading')}</p>
            <p className="mb-3 text-xs text-slate-500">{t('wall.private_hint')}</p>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="edit-country">{t('memberDashboard.profile_country_label')}</label>
                <input id="edit-country" className="input" value={locationCountry} maxLength={100} onChange={(e) => setLocationCountry(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="edit-city">{t('memberDashboard.profile_city_label')}</label>
                <input id="edit-city" className="input" value={locationCity} maxLength={100} onChange={(e) => setLocationCity(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="edit-area">{t('memberDashboard.profile_area_label')}</label>
                <input id="edit-area" className="input" value={locationArea} maxLength={100} onChange={(e) => setLocationArea(e.target.value)} />
              </div>
              <p className="text-xs text-slate-500">
                {t('wall.email_label')}: {member.email}
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? t('wall.saving') : t('wall.save')}
          </button>
        </form>
        <DataSaverSetting />
      </section>
    </PageShell>
  );
}
