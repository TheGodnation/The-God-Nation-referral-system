import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

export interface MuteInfo {
  id: string;
  reason: string;
  endsAt: string;
  excuseSent: boolean;
}

// Shown in place of the message box while the person is muted in this assembly: why, until when,
// and one request for excuse.
export function MutedBanner({ mute, onChanged }: { mute: MuteInfo; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = new Date(mute.endsAt).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/member/sanctions/${mute.id}/excuse`, { message: text });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sanctions.excuse_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-amber-50 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 text-sm text-amber-950" data-testid="muted-banner">
      <p className="font-semibold">🔇 {t('sanctions.muted_until', { date: until })}</p>
      <p className="mt-1">{t('sanctions.reason_label')} {mute.reason}</p>
      {mute.excuseSent ? (
        <p className="mt-2 text-amber-800">🙏 {t('sanctions.excuse_sent')}</p>
      ) : open ? (
        <form onSubmit={send} className="mt-2 space-y-2">
          <textarea className="input w-full" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('sanctions.excuse_placeholder') ?? ''} aria-label={t('sanctions.excuse_placeholder') ?? ''} />
          {error && <p className="text-red-700" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary px-4 py-2" disabled={busy || text.trim().length < 3}>{busy ? t('sanctions.sending') : t('sanctions.excuse_send')}</button>
            <button type="button" className="btn-secondary px-4 py-2" onClick={() => setOpen(false)}>{t('sanctions.cancel')}</button>
          </div>
        </form>
      ) : (
        <button type="button" className="mt-2 font-semibold text-brand-700 underline" onClick={() => setOpen(true)}>{t('sanctions.excuse_ask')}</button>
      )}
    </div>
  );
}
