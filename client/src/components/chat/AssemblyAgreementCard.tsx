import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

const RULES = [1, 2, 3, 4, 5] as const;

// Shown in place of the message box while a new member has not yet agreed to the assembly's rules. They are already in
// the group: they can read and react to messages, but cannot post or reply until they tap "I agree". Agreeing counts as
// having joined the assembly.
export function AssemblyAgreementCard({ communityId, onAgreed }: { communityId: string; onAgreed: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="max-h-[70vh] overflow-y-auto bg-brand-50 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 text-sm text-brand-950" data-testid="assembly-agreement">
      <h2 className="text-base font-bold text-brand-900">{t('assemblyAgreement.title')}</h2>
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
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void agree()} className="btn-primary mt-3 w-full py-2 disabled:opacity-60" data-testid="assembly-agree">
        {busy ? t('assemblyAgreement.working') : t('assemblyAgreement.agree')}
      </button>
    </div>
  );
}
