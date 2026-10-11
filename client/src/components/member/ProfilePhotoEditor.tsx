import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { Avatar } from '../Avatar';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

// The member's own profile picture with buttons to add, change or remove
// it. Upload goes: ask the server for an upload link -> send the image
// straight to storage -> tell the server it's done (it double-checks).
export function ProfilePhotoEditor() {
  const { t } = useTranslation();
  const { member, refresh } = useMemberAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!member) return null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ALLOWED.includes(file.type)) {
      setError(t('memberDashboard.photo_wrong_type'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('memberDashboard.photo_too_large'));
      return;
    }
    setBusy(true);
    try {
      const auth = await api.post<{ storageKey: string; uploadUrl: string }>('/api/member/me/photo/authorize', {
        mimeType: file.type,
        byteSize: file.size,
      });
      const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('upload failed');
      await api.post('/api/member/me/photo', { storageKey: auth.storageKey, mimeType: file.type, byteSize: file.size });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STORAGE_UNAVAILABLE') setError(t('memberDashboard.photo_unavailable'));
      else setError(t('memberDashboard.photo_failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await api.delete('/api/member/me/photo');
      await refresh();
    } catch {
      setError(t('memberDashboard.photo_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-4">
      <Avatar name={member.name} photoUrl={member.photoUrl} size={72} />
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? t('memberDashboard.photo_uploading') : member.photoUrl ? t('memberDashboard.photo_change') : t('memberDashboard.photo_add')}
          </button>
          {member.photoUrl && !busy && (
            <button type="button" className="text-sm text-slate-500 underline" onClick={remove}>
              {t('memberDashboard.photo_remove')}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={ALLOWED.join(',')}
          className="hidden"
          aria-label={t('memberDashboard.photo_add') ?? ''}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
