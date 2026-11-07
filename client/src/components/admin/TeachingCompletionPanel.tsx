import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { pickText } from '../../lib/instructionText';

interface Teaching {
  id: string;
  title: string;
  titleTranslated: string | null;
  detectedLanguage: 'en' | 'fr' | null;
  assemblyName: string;
  passMark: number;
}
interface Person {
  personId: string;
  name: string;
  whatsappNumber: string;
  took: number;
  passed: number;
  results: Record<string, { percentage: number | null; passed: boolean | null } | null>;
  leads: string[];
  memberOf: { id: string; name: string }[];
}
interface Completion {
  teachings: Teaching[];
  people: Person[];
  tookAll: number;
  tookAny: number;
}
interface Assembly {
  id: string;
  name: string;
  teachings: number;
}

// Who did the teachings: everyone who handed in the quiz of at least one teaching of an assembly, with how many they
// did and whether they passed each (doing it and passing it are shown apart). Filter by "did all", "did at least N" or
// "did any", download the list as a spreadsheet, and make people on it leaders. Offered in the admin dashboard and in
// the central admin's member profile (base says which set of routes).
export function TeachingCompletionPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [assemblies, setAssemblies] = useState<Assembly[] | null>(null);
  const [communityId, setCommunityId] = useState<string>('');
  const [data, setData] = useState<Completion | null>(null);
  const [mode, setMode] = useState<'all' | 'atleast' | 'any'>('all');
  const [atLeast, setAtLeast] = useState('1');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: Assembly[] }>(`${base}/assemblies`)
      .then((r) => {
        setAssemblies(r.items);
        if (r.items[0]) setCommunityId(r.items[0].id);
      })
      .catch(() => setAssemblies([]));
  }, [base]);

  const load = () => {
    setData(null);
    api.get<Completion>(`${base}/?communityId=${encodeURIComponent(communityId)}`).then(setData).catch(() => setError(t('teachingDone.load_failed')));
  };
  useEffect(() => {
    if (assemblies && assemblies.length > 0 && communityId) load();
  }, [communityId, assemblies]);

  const total = data?.teachings.length ?? 0;
  const shown = useMemo(() => {
    if (!data) return [];
    const need = mode === 'all' ? total : mode === 'any' ? 1 : Math.max(1, Number(atLeast) || 1);
    return data.people.filter((p) => p.took >= need);
  }, [data, mode, atLeast, total]);

  async function appoint(p: Person) {
    const target = communityId || p.memberOf[0]?.id;
    if (!target) return;
    setBusyId(p.personId);
    setError(null);
    setMessage(null);
    try {
      await api.post(`${base}/appoint`, { personId: p.personId, communityId: target });
      setMessage(t('teachingDone.appointed', { name: p.name }));
      setConfirmId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('teachingDone.appoint_failed'));
    } finally {
      setBusyId(null);
    }
  }

  const selectedName = assemblies?.find((a) => a.id === communityId)?.name;
  return (
    <div className="space-y-4" data-testid="teaching-completion">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('teachingDone.title')}</h2>
        <p className="text-sm text-slate-600">{t('teachingDone.help')}</p>
      </div>

      {assemblies && assemblies.length === 0 && <p className="card text-sm text-slate-600">{t('teachingDone.none')}</p>}
      {assemblies && assemblies.length > 0 && (
        <label className="block text-sm font-semibold text-slate-700">
          {t('teachingDone.assembly')}
          <select className="input mt-1" value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({t('teachingDone.n_teachings', { count: a.teachings })})</option>
            ))}
          </select>
        </label>
      )}

      {data && (
        <>
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900" data-testid="completion-summary">
            {t('teachingDone.summary', { all: data.tookAll, total, any: data.tookAny })}
          </p>

          <fieldset className="space-y-1 text-sm">
            <legend className="font-semibold text-slate-700">{t('teachingDone.show')}</legend>
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'all'} onChange={() => setMode('all')} />{t('teachingDone.mode_all', { total })}</label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="mode" checked={mode === 'atleast'} onChange={() => setMode('atleast')} />
              {t('teachingDone.mode_atleast')}
              <input className="input w-16" inputMode="numeric" value={atLeast} onChange={(e) => { setAtLeast(e.target.value.replace(/\D/g, '')); setMode('atleast'); }} aria-label={t('teachingDone.mode_atleast') ?? ''} />
              <span>{t('teachingDone.of_total', { total })}</span>
            </label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'any'} onChange={() => setMode('any')} />{t('teachingDone.mode_any')}</label>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600" data-testid="completion-shown">{t('teachingDone.shown', { count: shown.length })}</p>
            <a className="btn-secondary px-3 py-1.5 text-sm no-underline" href={`${base}/export?communityId=${encodeURIComponent(communityId)}`} data-testid="completion-export">
              ⬇ {t('teachingDone.download')}
            </a>
          </div>
          {message && <p className="text-sm font-semibold text-green-800">{message}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}

          <ul className="space-y-2">
            {shown.map((p) => {
              const alreadyLeads = Boolean(selectedName && p.leads.includes(selectedName));
              return (
                <li key={p.personId} className="card space-y-2" data-testid={`completion-person-${p.personId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-semibold text-brand-900">{p.name}</span>
                      <span className="block text-xs text-slate-500">{p.whatsappNumber}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-semibold text-slate-800">{t('teachingDone.did_of', { took: p.took, total })}</span>
                      <span className="block text-slate-500">{t('teachingDone.passed_n', { count: p.passed })}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label={t('teachingDone.dots_label') ?? ''}>
                    {data.teachings.map((tg) => {
                      const r = p.results[tg.id];
                      const label = pickText(i18n.language, tg.detectedLanguage, tg.title, tg.titleTranslated);
                      const text = !r ? t('teachingDone.not_done') : `${r.percentage === null ? '' : `${Math.round(r.percentage)}% `}${r.passed ? t('teachingDone.passed') : t('teachingDone.not_passed')}`;
                      return (
                        <span key={tg.id} title={`${label}: ${text}`} className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${!r ? 'bg-slate-100 text-slate-400' : r.passed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
                          {!r ? '–' : r.percentage === null ? '✓' : `${Math.round(r.percentage)}%`}
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">{p.leads.length > 0 ? t('teachingDone.leads', { list: p.leads.join(', ') }) : ''}</span>
                    {alreadyLeads ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">{t('teachingDone.already_leader')}</span>
                    ) : confirmId === p.personId ? (
                      <span className="flex gap-2">
                        <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busyId === p.personId} onClick={() => void appoint(p)} data-testid="completion-appoint-confirm">
                          {t('teachingDone.confirm_appoint', { assembly: selectedName ?? p.memberOf[0]?.name ?? '' })}
                        </button>
                        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setConfirmId(null)}>{t('instructions.cancel')}</button>
                      </span>
                    ) : (
                      <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setConfirmId(p.personId)} data-testid="completion-appoint">
                        {t('teachingDone.make_leader')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className="card text-sm text-slate-600">{t('teachingDone.nobody')}</p>}
        </>
      )}
      {assemblies && assemblies.length > 0 && !data && !error && <p className="text-sm text-slate-500">{t('instructions.loading')}</p>}
    </div>
  );
}
