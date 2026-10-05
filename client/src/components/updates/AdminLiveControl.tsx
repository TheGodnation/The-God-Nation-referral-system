import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import type { LiveInfo } from './LiveBanner';

// Central admin: put a YouTube live (video or audio-only) at the top of
// everyone's Updates page, and take it down when it ends.
export function AdminLiveControl() {
  const { t } = useTranslation();
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ live: LiveInfo | null }>('/api/updates/live')
      .then((res) => setLive(res.live))
      .catch(() => {});
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) {
      setError(t('updates.admin_live_need_link'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.put<{ live: LiveInfo }>('/api/updates/live', { youtubeUrl: url.trim(), title: title.trim() || undefined });
      setLive(res.live);
      setUrl('');
      setTitle('');
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INVALID_YOUTUBE' ? t('updates.invalid_youtube') : t('updates.admin_live_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/api/updates/live');
      setLive(null);
    } catch {
      setError(t('updates.admin_live_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-brand-900">{t('updates.admin_live_heading')}</h3>
      {live ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            <span className="mr-2 rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">{t('updates.live_badge')}</span>
            {live.title || t('updates.live_default_title')}
          </p>
          <button type="button" className="btn-secondary" onClick={end} disabled={busy}>
            {t('updates.admin_live_end')}
          </button>
        </div>
      ) : (
        <form onSubmit={start} className="space-y-2">
          <p className="text-sm text-slate-600">{t('updates.admin_live_help')}</p>
          <input
            className="input"
            aria-label={t('updates.admin_live_link') ?? ''}
            placeholder="https://www.youtube.com/live/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="input"
            aria-label={t('updates.admin_live_title') ?? ''}
            placeholder={t('updates.admin_live_title') ?? ''}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('updates.admin_live_start')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
