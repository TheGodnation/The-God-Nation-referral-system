import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';

interface SuspectPerson {
  id: string;
  name: string;
  photoUrl: string | null;
  whatsappNumber: string;
  signInEmail: string | null;
  joinedAt: string;
  hasAccount: boolean;
}
interface Suspect {
  a: SuspectPerson;
  b: SuspectPerson;
  signs: ('email' | 'name' | 'phone')[];
}

const day = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Accounts that may be ONE person (the same inbox written differently, the same name, almost the same phone). It only
// suggests: "Merge" opens the merge tool with both chosen (you still preview and confirm there), and "Not the same
// person" hides the pair for good.
export function DuplicateSuspectsCard({ base, onMerge }: { base: string; onMerge: (keepId: string, dupId: string) => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Suspect[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await api.get<{ items: Suspect[] }>(`${base}/duplicate-suspects`)).items);
    } catch {
      setError(t('duplicates.load_failed'));
    }
  }, [base, t]);

  async function notSame(s: Suspect) {
    setError(null);
    try {
      await api.post(`${base}/duplicate-suspects/dismiss`, { personAId: s.a.id, personBId: s.b.id });
      setItems((prev) => (prev ?? []).filter((x) => !(x.a.id === s.a.id && x.b.id === s.b.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('duplicates.failed'));
    }
  }

  const who = (p: SuspectPerson) => (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <Avatar name={p.name} photoUrl={p.photoUrl} size={40} />
      <div className="min-w-0 text-sm">
        <p className="truncate font-semibold text-slate-900">{p.name}</p>
        <p className="truncate text-xs text-slate-600">{p.whatsappNumber}</p>
        <p className="truncate text-xs text-slate-600">{p.signInEmail ?? t('duplicates.no_email')}</p>
        <p className="text-xs text-slate-500">{t('duplicates.joined', { date: day(p.joinedAt, i18n.language) })}</p>
      </div>
    </div>
  );

  return (
    <details className="card space-y-3" data-testid="duplicate-suspects" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && items === null && void load()}>
      <summary className="cursor-pointer font-semibold text-brand-900">{t('duplicates.title')}</summary>
      <p className="text-sm text-slate-600">{t('duplicates.intro')}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {items && items.length === 0 && <p className="text-sm text-slate-500" data-testid="duplicates-none">{t('duplicates.none')}</p>}
      <ul className="space-y-3">
        {(items ?? []).map((s) => (
          <li key={`${s.a.id}-${s.b.id}`} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`suspect-${s.a.id}-${s.b.id}`}>
            <p className="mb-2 flex flex-wrap gap-1.5 text-xs">
              {s.signs.map((k) => (
                <span key={k} className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">{t(`duplicates.sign_${k}`)}</span>
              ))}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {who(s.a)}
              {who(s.b)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => onMerge(s.a.id, s.b.id)} data-testid={`suspect-merge-${s.a.id}-${s.b.id}`}>
                {t('duplicates.merge')}
              </button>
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => void notSame(s)} data-testid={`suspect-no-${s.a.id}-${s.b.id}`}>
                {t('duplicates.not_same')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {items && <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => void load()}>{t('duplicates.refresh')}</button>}
    </details>
  );
}
