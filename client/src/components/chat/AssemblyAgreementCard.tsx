import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

const RULES = [1, 2, 3, 4, 5] as const;

// Shown in place of the message box while a new member has not yet agreed to the assembly's rules. They are already in
// the group: they can read and react to messages, but cannot post or reply until they tap "I agree". Agreeing counts as
// having joined the assembly.
//
// It never covers the group. It starts as one small bar (a line and a "Read the rules" button) under the messages, so the
// activity in the group stays in view. Tapping it opens the rules in a short panel (under half the screen) that scrolls,
// with "I agree" always at its bottom; the group stays visible and scrollable above it, and the panel can be hidden again.
export function AssemblyAgreementCard({ communityId, onAgreed }: { communityId: string; onAgreed: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/communities/${communityId}/agreement`, {});
      onAgreed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('assemblyAgreement.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3 border-t border-brand-100 bg-brand-50 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 text-brand-950" data-testid="assembly-agreement">
        <p className="min-w-0 flex-1 text-sm">
          <strong className="text-brand-900">{t('assemblyAgreement.title')}</strong>
          <span className="block text-xs text-brand-800">{t('assemblyAgreement.short')}</span>
        </p>
        <button type="button" onClick={() => setOpen(true)} className="btn-primary shrink-0 px-3 py-2 text-sm" data-testid="assembly-read">
          {t('assemblyAgreement.read')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-h-[45vh] flex-col border-t border-brand-100 bg-brand-50 text-sm text-brand-950" data-testid="assembly-agreement">
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <h2 className="text-base font-bold text-brand-900">{t('assemblyAgreement.title')}</h2>
        <button type="button" onClick={() => setOpen(false)} className="shrink-0 px-2 py-1 text-xs font-semibold text-brand-700 underline" data-testid="assembly-hide">
          {t('assemblyAgreement.hide')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-testid="assembly-rules">
        <p className="mt-1 text-brand-900">{t('assemblyAgreement.intro')}</p>
        <ol className="mt-2 space-y-2">
          {RULES.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">{n}</span>
              <span>
                <strong>{t(`assemblyAgreement.rule${n}_title`)}</strong> {t(`assemblyAgreement.rule${n}_body`)}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="border-t border-brand-100 bg-brand-50 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
        {error && <p role="alert" className="mb-1 text-xs text-red-700">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void agree()} className="btn-primary w-full py-2 disabled:opacity-60" data-testid="assembly-agree">
          {busy ? t('assemblyAgreement.working') : t('assemblyAgreement.agree')}
        </button>
      </div>
    </div>
  );
}
