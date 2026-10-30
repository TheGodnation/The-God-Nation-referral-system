import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

// For the central admin and the assembly's leaders: how many members failed
// the quiz and can still retake, and one button to remind them all.
export function RetakeInvite({ teachingId, refreshKey }: { teachingId: string; refreshKey?: string }) {
  const { t } = useTranslation();
  const [waiting, setWaiting] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ retake?: { waiting: number } }>(`/api/teachings/${teachingId}/results`)
      .then((r) => setWaiting(r.retake?.waiting ?? 0))
      .catch(() => setWaiting(null));
  }, [teachingId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function remind() {
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.post<{ invited: number }>(`/api/teachings/${teachingId}/retake-invite`, {});
      setMessage(t(res.invited > 0 ? 'teaching.retake_invited' : 'teaching.retake_invite_none', { count: res.invited }));
      load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t('teaching.retake_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (waiting === null) return null;
  return (
    <div className="space-y-2 rounded-xl bg-sky-50 p-4 shadow-sm" data-testid="teaching-retake-invite">
      <h2 className="font-semibold text-sky-900">🔁 {t('teaching.retake_manage_title')}</h2>
      <p className="text-sm text-sky-900">{waiting > 0 ? t('teaching.retake_waiting', { count: waiting }) : t('teaching.retake_invite_none')}</p>
      <button type="button" className="btn-primary w-full" onClick={() => void remind()} disabled={busy || waiting === 0}>
        🔔 {t('teaching.retake_invite')}
      </button>
      {message && <p className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}
