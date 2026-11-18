import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface Described {
  id: string;
  name: string;
  whatsappNumber: string;
  signInEmail: string | null;
  leaderSignIn: boolean;
  leaderOf: string[];
  assemblies: number;
  peopleHeFollows: number;
  leadersFollowingHim: number;
  messages: number;
}
interface Report {
  summary: {
    roles: number;
    peopleHeFollows: number;
    leadersFollowingHim: number;
    memberships: number;
    messages: number;
    posts: number;
    learning: number;
    other: number;
    dropped: number;
    betweenThem: number;
  };
  droppedSignInEmail: string | null;
  signInEmail: string | null;
  duplicate: { name: string; whatsappNumber: string };
}

// One person with two accounts: choose the account he really uses (it stays) and the duplicate (merged into it, then
// removed). Everything continues on the kept account: his leader role, the people he follows, who follows him, his
// assemblies, chats, posts and progress. A preview shows exactly what would move before anything changes.
export function MergeAccountsCard({ base, prefill }: { base: string; prefill?: { keepId: string; dupId: string; nonce: number } | null }) {
  const { t } = useTranslation();
  const [keep, setKeep] = useState<Described | null>(null);
  const [dup, setDup] = useState<Described | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // When both accounts have a sign-in email, only one of them opens the account afterwards.
  const [emailChoice, setEmailChoice] = useState<'keep' | 'duplicate'>('keep');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  // Opened from "Possible duplicates" with the two accounts already chosen (the older one to keep; "Swap" turns them round).
  useEffect(() => {
    if (!prefill) return;
    let alive = true;
    setOpen(true);
    setPreview(null);
    setDone(null);
    setError(null);
    setEmailChoice('keep');
    Promise.all([
      api.get<Described>(`${base}/merge-people/describe?personId=${encodeURIComponent(prefill.keepId)}`),
      api.get<Described>(`${base}/merge-people/describe?personId=${encodeURIComponent(prefill.dupId)}`),
    ])
      .then(([k, d]) => {
        if (!alive) return;
        setKeep(k);
        setDup(d);
        window.setTimeout(() => ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50);
      })
      .catch(() => alive && setError(t('mergeAccounts.load_failed')));
    return () => {
      alive = false;
    };
  }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  function swap() {
    setKeep(dup);
    setDup(keep);
    setPreview(null);
    setEmailChoice('keep');
  }

  async function pick(which: 'keep' | 'dup', item: { id: string }) {
    setPreview(null);
    setDone(null);
    setError(null);
    setEmailChoice('keep');
    try {
      const info = await api.get<Described>(`${base}/merge-people/describe?personId=${encodeURIComponent(item.id)}`);
      if (which === 'keep') setKeep(info);
      else setDup(info);
    } catch {
      setError(t('mergeAccounts.load_failed'));
    }
  }

  async function run(dryRun: boolean) {
    if (!keep || !dup) return;
    if (!dryRun && !window.confirm(t('mergeAccounts.confirm', { duplicate: dup.name, kept: keep.name }) ?? '')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ dryRun: boolean; report: Report }>(`${base}/merge-people`, { keepPersonId: keep.id, mergePersonId: dup.id, dryRun, signInEmail: emailChoice });
      if (dryRun) {
        setPreview(r.report);
      } else {
        setPreview(null);
        setDone(t('mergeAccounts.done', { duplicate: dup.name, kept: keep.name }));
        setDup(null);
        setKeep(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('mergeAccounts.failed'));
    } finally {
      setBusy(false);
    }
  }

  const same = keep && dup && keep.id === dup.id;

  const card = (info: Described) => (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm" data-testid={`merge-card-${info.id}`}>
      <p className="font-semibold text-slate-900">{info.name}</p>
      <p className="text-slate-600">{info.whatsappNumber}{info.signInEmail ? ` · ${info.signInEmail}` : ''}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
        {info.leaderOf.length > 0 && <li>{t('mergeAccounts.leader_of', { names: info.leaderOf.join(', ') })}</li>}
        <li>{t('mergeAccounts.stats', { assemblies: info.assemblies, follows: info.peopleHeFollows, followers: info.leadersFollowingHim, messages: info.messages })}</li>
      </ul>
    </div>
  );

  const s = preview?.summary;
  const lines: [string, number][] = s
    ? ([
        ['roles', s.roles],
        ['follows', s.peopleHeFollows],
        ['followers', s.leadersFollowingHim],
        ['memberships', s.memberships],
        ['messages', s.messages],
        ['posts', s.posts],
        ['learning', s.learning],
        ['other', s.other],
      ] as [string, number][]).filter(([, n]) => n > 0)
    : [];

  return (
    <details ref={ref} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="card scroll-mt-4 space-y-3" data-testid="merge-accounts">
      <summary className="cursor-pointer font-semibold text-brand-900">{t('mergeAccounts.title')}</summary>
      <p className="text-sm text-slate-600">{t('mergeAccounts.intro')}</p>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800">1. {t('mergeAccounts.keep_label')}</p>
        <SearchPicker
          placeholder={t('mergeAccounts.search_placeholder')}
          searchPath={`${base}/people?search=`}
          renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
          actionLabel={t('mergeAccounts.keep_action')}
          searchButtonLabel={t('mergeAccounts.search')}
          onPick={(p) => void pick('keep', p)}
        />
        {keep && card(keep)}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800">2. {t('mergeAccounts.dup_label')}</p>
        <SearchPicker
          placeholder={t('mergeAccounts.search_placeholder')}
          searchPath={`${base}/people?search=`}
          renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
          actionLabel={t('mergeAccounts.dup_action')}
          searchButtonLabel={t('mergeAccounts.search')}
          onPick={(p) => void pick('dup', p)}
        />
        {dup && card(dup)}
      </div>

      {keep && dup && !same && (
        <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={swap} data-testid="merge-swap">
          ⇅ {t('mergeAccounts.swap')}
        </button>
      )}

      {keep && dup && !same && keep.signInEmail && dup.signInEmail && (
        <fieldset className="space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm" data-testid="merge-email-choice">
          <legend className="px-1 font-semibold text-slate-800">3. {t('mergeAccounts.email_title')}</legend>
          <p className="text-xs text-slate-600">{t('mergeAccounts.email_help')}</p>
          <label className="flex items-start gap-2">
            <input type="radio" name="merge-email" className="mt-1" checked={emailChoice === 'keep'} onChange={() => { setEmailChoice('keep'); setPreview(null); }} />
            <span>{keep.signInEmail} <span className="text-xs text-slate-500">({t('mergeAccounts.email_kept')})</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="merge-email" className="mt-1" checked={emailChoice === 'duplicate'} onChange={() => { setEmailChoice('duplicate'); setPreview(null); }} />
            <span>{dup.signInEmail} <span className="text-xs text-slate-500">({t('mergeAccounts.email_duplicate')})</span></span>
          </label>
        </fieldset>
      )}

      {same && <p className="text-sm text-red-700">{t('mergeAccounts.same')}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{done}</p>}

      <button type="button" className="btn-secondary px-3 py-1.5" disabled={busy || !keep || !dup || Boolean(same)} onClick={() => void run(true)} data-testid="merge-preview">
        {t('mergeAccounts.preview')}
      </button>

      {preview && keep && dup && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="merge-report">
          <p className="font-semibold text-slate-900">{t('mergeAccounts.report_title', { duplicate: dup.name, kept: keep.name })}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
            {lines.map(([key, n]) => (
              <li key={key}>{t(`mergeAccounts.line_${key}`, { count: n })}</li>
            ))}
            {lines.length === 0 && <li>{t('mergeAccounts.line_nothing')}</li>}
          </ul>
          {preview.summary.dropped > 0 && <p className="text-xs text-slate-600">{t('mergeAccounts.dropped', { count: preview.summary.dropped })}</p>}
          {preview.summary.betweenThem > 0 && <p className="text-xs text-slate-600">{t('mergeAccounts.between', { count: preview.summary.betweenThem })}</p>}
          {preview.signInEmail && <p className="text-xs text-slate-700">{t('mergeAccounts.email_after', { email: preview.signInEmail })}</p>}
          {preview.droppedSignInEmail && <p className="text-xs text-slate-600">{t('mergeAccounts.email_note', { email: preview.droppedSignInEmail })}</p>}
          <p className="text-xs font-semibold text-red-700">{t('mergeAccounts.no_undo')}</p>
          <button type="button" className="btn-primary px-3 py-1.5" disabled={busy} onClick={() => void run(false)} data-testid="merge-go">
            {t('mergeAccounts.merge_now')}
          </button>
        </div>
      )}
    </details>
  );
}
