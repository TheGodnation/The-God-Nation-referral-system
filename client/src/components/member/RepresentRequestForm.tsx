import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { LocationFields, locationFrom, locationCountry, type LocationValue } from './LocationFields';

type Level = 'NATIONAL' | 'REGION' | 'DIVISION' | 'SUBDIVISION' | 'QUARTER';

interface AreaOption {
  id: string;
  name: string;
  level: Level;
}

interface MyRequestRow {
  id: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decisionNote: string | null;
  area: AreaOption | null;
  typedCountry?: string | null;
  typedRegion?: string | null;
  typedDivision?: string | null;
  typedSubdivision?: string | null;
  typedQuarter?: string | null;
}

// The steps a member walks down to name their place, one list after another.
const STEPS: Exclude<Level, 'NATIONAL'>[] = ['REGION', 'DIVISION', 'SUBDIVISION', 'QUARTER'];

const requestPlace = (r: MyRequestRow) =>
  r.area ? r.area.name : [r.typedQuarter, r.typedSubdivision, r.typedDivision, r.typedRegion, r.typedCountry].filter(Boolean).join(', ');

// "Represent The God Nation in your area": the member picks their place from
// the lists (region, then division, then subdivision, then quarter), or — when
// their place is not listed yet — types it in. The central authority reviews
// the request and contacts them; nothing is granted by sending it.
export function RepresentRequestForm({
  country,
  rootId,
  fixedArea,
  onClearFixedArea,
  onChanged,
  startOpen = false,
}: {
  country: string;
  /** The country's own area (the top of the lists). */
  rootId: string;
  /** A place chosen elsewhere on the page ("Represent this place"). */
  fixedArea?: { id: string; label: string } | null;
  onClearFixedArea?: () => void;
  onChanged?: () => void;
  /** Opens the form at once (the "Request to represent your area" button on the People page). */
  startOpen?: boolean;
}) {
  const { t } = useTranslation();
  // With no places set up yet (no list to pick from) the member types their place.
  const noList = !rootId;
  const [open, setOpen] = useState(startOpen);
  const [options, setOptions] = useState<AreaOption[][]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [notListed, setNotListed] = useState(noList);
  // A place that is not on the lists: the same pick-lists as the profile (country, then region, division, subdivision, quarter).
  const [loc, setLoc] = useState<LocationValue>(() => locationFrom({ country }));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [myRequests, setMyRequests] = useState<MyRequestRow[] | null>(null);

  function loadMine() {
    api
      .get<{ items: MyRequestRow[] }>('/api/member/area-representation-requests/mine')
      .then((res) => setMyRequests(res.items))
      .catch(() => setMyRequests([]));
  }
  useEffect(loadMine, []);

  // A place chosen on the page opens the form with that place already set.
  useEffect(() => {
    if (fixedArea) {
      setOpen(true);
      setNotListed(false);
    }
  }, [fixedArea]);

  // The first list (regions) loads when the form opens; each choice loads the
  // next list down.
  useEffect(() => {
    if (!open || fixedArea || notListed || options.length > 0 || !rootId) return;
    api
      .get<{ items: AreaOption[] }>(`/api/member/geographic-areas?parentId=${encodeURIComponent(rootId)}`)
      .then((res) => setOptions([res.items]))
      .catch(() => setOptions([[]]));
  }, [open, fixedArea, notListed, options.length, rootId]);

  function choose(step: number, id: string) {
    const next = picked.slice(0, step);
    if (id) next.push(id);
    setPicked(next);
    setOptions((cur) => cur.slice(0, step + 1));
    if (id && step < STEPS.length - 1) {
      api
        .get<{ items: AreaOption[] }>(`/api/member/geographic-areas?parentId=${encodeURIComponent(id)}`)
        .then((res) => setOptions((cur) => [...cur.slice(0, step + 1), res.items]))
        .catch(() => undefined);
    }
  }

  const pending = myRequests?.find((r) => r.status === 'PENDING') ?? null;
  const areaId = fixedArea?.id ?? (picked.length > 0 ? picked[picked.length - 1] : '');

  // Members ask to represent a subdivision or a quarter within one; regions and divisions are appointed by
  // the central authority. If the subdivision already has a representative, only a quarter can be asked for.
  const [taken, setTaken] = useState<{ represented: boolean; representatives: string[] } | null>(null);
  const subdivisionAreaId = !notListed && !fixedArea ? (picked[2] ?? '') : '';
  const typedSubdivision = notListed ? loc.subdivision.trim() : '';
  useEffect(() => {
    setTaken(null);
    let live = true;
    const query = subdivisionAreaId
      ? `areaId=${encodeURIComponent(subdivisionAreaId)}`
      : typedSubdivision && loc.division.trim() && loc.region.trim()
        ? `country=${encodeURIComponent(locationCountry(loc))}&region=${encodeURIComponent(loc.region.trim())}&division=${encodeURIComponent(loc.division.trim())}&subdivision=${encodeURIComponent(typedSubdivision)}`
        : '';
    if (!query) return;
    api
      .get<{ represented: boolean; representatives: string[] }>(`/api/member/leadership-directory/subdivision-status?${query}`)
      .then((r) => live && setTaken(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [subdivisionAreaId, typedSubdivision, loc.division, loc.region]); // eslint-disable-line react-hooks/exhaustive-deps
  const quarterNeeded = Boolean(taken?.represented);
  const canSend = fixedArea
    ? Boolean(areaId)
    : notListed
      ? loc.region.trim().length > 0 && loc.division.trim().length > 0 && typedSubdivision.length > 0 && (!quarterNeeded || loc.quarter.trim().length > 0)
      : picked.length >= (quarterNeeded ? 4 : 3);

  // What the person is asking to represent: their subdivision, or a quarter within it.
  const asking: { level: 'SUBDIVISION' | 'QUARTER'; name: string } | null = (() => {
    if (fixedArea) return null;
    if (notListed) {
      if (loc.quarter.trim()) return { level: 'QUARTER', name: loc.quarter.trim() };
      return typedSubdivision ? { level: 'SUBDIVISION', name: typedSubdivision } : null;
    }
    const i = picked.length - 1;
    const name = i >= 0 ? options[i]?.find((a) => a.id === picked[i])?.name : undefined;
    return i >= 2 && name ? { level: i >= 3 ? 'QUARTER' : 'SUBDIVISION', name } : null;
  })();
  const takenNotice = quarterNeeded ? (
    <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status" data-testid="subdivision-taken">
      {t('leadershipDirectory.subdivision_taken', { names: taken!.representatives.join(', ') })}
    </p>
  ) : null;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/member/area-representation-requests', {
        ...(notListed
          ? {
              typedCountry: locationCountry(loc),
              typedRegion: loc.region.trim(),
              typedDivision: loc.division.trim() || undefined,
              typedSubdivision: loc.subdivision.trim() || undefined,
              typedQuarter: loc.quarter.trim() || undefined,
            }
          : { areaId }),
        note: note.trim() || undefined,
      });
      setSent(true);
      setOpen(false);
      setPicked([]);
      setOptions([]);
      setLoc(locationFrom({ country }));
      setNote('');
      onClearFixedArea?.();
      loadMine();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('leadershipDirectory.already_pending') : t('leadershipDirectory.geo_submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(id: string) {
    if (!window.confirm(t('leadershipDirectory.withdraw_confirm') ?? '')) return;
    try {
      await api.delete(`/api/member/area-representation-requests/${id}`);
      setSent(false);
      loadMine();
    } catch {
      setError(t('leadershipDirectory.withdraw_failed'));
    }
  }

  const stepLabel = (i: number) => t(`leadershipDirectory.pick_${STEPS[i].toLowerCase()}`);

  return (
    <section id="represent" className="card space-y-3" aria-labelledby="represent-title">
      <div>
        <h2 id="represent-title" className="font-semibold text-brand-900">
          {t('leadershipDirectory.represent_title')}
        </h2>
        <p className="text-sm text-slate-600">{t('leadershipDirectory.represent_help')}</p>
      </div>

      {sent && (
        <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <p className="font-semibold">{t('leadershipDirectory.sent_title')}</p>
          <p>{t('leadershipDirectory.sent_body')}</p>
        </div>
      )}

      {pending ? (
        <div className="rounded-lg bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-800">{requestPlace(pending)}</p>
          <p className="mt-1 text-amber-700">{t('leadershipDirectory.status_pending')}</p>
          <button type="button" className="mt-2 text-xs text-red-700 underline" onClick={() => void withdraw(pending.id)}>
            {t('leadershipDirectory.withdraw')}
          </button>
        </div>
      ) : !open ? (
        <button type="button" className="btn-primary px-4 py-2" onClick={() => setOpen(true)}>
          {t('leadershipDirectory.represent_cta')}
        </button>
      ) : (
        <div className="space-y-3">
          {fixedArea ? (
            <p className="rounded-lg bg-brand-50 p-2 text-sm text-brand-900">
              {fixedArea.label}{' '}
              <button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={onClearFixedArea}>
                {t('admin.roleAssignments.change')}
              </button>
            </p>
          ) : notListed ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">{t('leadershipDirectory.typed_help')}</p>
              <LocationFields
                value={loc}
                onChange={setLoc}
                idPrefix="typed"
                hints={{
                  subdivision: (
                    <>
                      <p className="mt-1 text-xs text-slate-600">{t('leadershipDirectory.subdivision_hint')}</p>
                      {takenNotice}
                    </>
                  ),
                  quarter: <p className="mt-1 text-xs text-slate-600">{t('leadershipDirectory.quarter_hint')}</p>,
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {options.map((list, i) =>
                list.length === 0 && i > 0 ? null : (
                  <div key={i}>
                    <label className="label" htmlFor={`pick-${i}`}>
                      {stepLabel(i)}
                    </label>
                    <select id={`pick-${i}`} className="input" value={picked[i] ?? ''} onChange={(e) => choose(i, e.target.value)}>
                      <option value="">{t('leadershipDirectory.choose')}</option>
                      {list.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    {i === 2 && (
                      <>
                        <p className="mt-1 text-xs text-slate-600">{t('leadershipDirectory.subdivision_hint')}</p>
                        {takenNotice}
                      </>
                    )}
                    {i === 3 && <p className="mt-1 text-xs text-slate-600">{t('leadershipDirectory.quarter_hint')}</p>}
                  </div>
                ),
              )}
              {options.length === 0 && <p className="text-sm text-slate-400">{t('memberDashboard.loading')}</p>}
              <p className="text-xs text-slate-500">{t('leadershipDirectory.pick_help')}</p>
            </div>
          )}

          {!fixedArea && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{t('leadershipDirectory.level_help')}</p>}
          {asking && (
            <p className="rounded-lg bg-brand-50 p-2 text-sm text-brand-900" data-testid="asking-for">
              {t('leadershipDirectory.asking_for')}{' '}
              <strong>
                {t(`leadershipDirectory.level_${asking.level.toLowerCase()}`)} — {asking.name}
              </strong>
            </p>
          )}

          {!fixedArea && !noList && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={notListed} onChange={(e) => setNotListed(e.target.checked)} />
              {t('leadershipDirectory.not_listed')}
            </label>
          )}

          <textarea
            className="input"
            rows={2}
            maxLength={500}
            aria-label={t('leadershipDirectory.note_label') ?? ''}
            placeholder={t('leadershipDirectory.note_label') ?? ''}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-4 py-2" disabled={submitting || !canSend} onClick={() => void submit()}>
              {t('leadershipDirectory.submit')}
            </button>
            <button
              type="button"
              className="px-3 py-2 text-sm text-slate-600"
              onClick={() => {
                setOpen(false);
                onClearFixedArea?.();
              }}
            >
              {t('chatActions.cancel')}
            </button>
          </div>
          <p className="text-xs text-slate-500">{t('leadershipDirectory.review_note')}</p>
        </div>
      )}

      {myRequests && myRequests.some((r) => r.status !== 'PENDING') && (
        <ul className="divide-y divide-slate-100 text-sm">
          {myRequests
            .filter((r) => r.status !== 'PENDING')
            .map((r) => (
              <li key={r.id} className="py-2">
                <p className="font-medium text-slate-800">{requestPlace(r)}</p>
                <p className={r.status === 'APPROVED' ? 'text-green-700' : 'text-red-700'}>{t(`leadershipDirectory.status_${r.status.toLowerCase()}`)}</p>
                {r.decisionNote && (
                  <p className="mt-0.5 text-xs italic text-slate-500">
                    {t('leadershipDirectory.decision_note_label')} {r.decisionNote}
                  </p>
                )}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
