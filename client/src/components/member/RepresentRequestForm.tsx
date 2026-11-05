import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { LocationFields, locationFrom, locationCountry, type LocationValue } from './LocationFields';

interface MyRequestRow {
  id: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decisionNote: string | null;
  area: { id: string; name: string; level: string } | null;
  typedCountry?: string | null;
  typedRegion?: string | null;
  typedDivision?: string | null;
  typedSubdivision?: string | null;
  typedQuarter?: string | null;
}

const requestPlace = (r: MyRequestRow) =>
  r.area ? r.area.name : [r.typedQuarter, r.typedSubdivision, r.typedDivision, r.typedRegion, r.typedCountry].filter(Boolean).join(', ');

// "Represent The God Nation in your area". The member names where they live from the lists (country, region,
// division, then the exact subdivision) and says what they want to represent: the subdivision itself, or a
// quarter within it. If the subdivision already has a representative, only a quarter within it can be asked
// for. Regions and divisions are appointed by the central authority. The central authority reviews the request
// and contacts them; nothing is granted by sending it.
export function RepresentRequestForm({
  country,
  fixedArea,
  onClearFixedArea,
  onChanged,
  startOpen = false,
  onCancel,
}: {
  country: string;
  /** A place chosen elsewhere ("Represent this place" in the directory). */
  fixedArea?: { id: string; label: string } | null;
  onClearFixedArea?: () => void;
  onChanged?: () => void;
  /** Opens the form at once. */
  startOpen?: boolean;
  /** On a page of its own, Cancel goes back instead of just closing the form. */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(startOpen);
  const [loc, setLoc] = useState<LocationValue>(() => locationFrom({ country }));
  const [scope, setScope] = useState<'SUBDIVISION' | 'QUARTER'>('SUBDIVISION');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [myRequests, setMyRequests] = useState<MyRequestRow[] | null>(null);
  const [taken, setTaken] = useState<{ represented: boolean; representatives: string[] } | null>(null);

  function loadMine() {
    api
      .get<{ items: MyRequestRow[] }>('/api/member/area-representation-requests/mine')
      .then((res) => setMyRequests(res.items))
      .catch(() => setMyRequests([]));
  }
  useEffect(loadMine, []);

  // A place chosen elsewhere opens the form with that place already set.
  useEffect(() => {
    if (fixedArea) setOpen(true);
  }, [fixedArea]);

  const pending = myRequests?.find((r) => r.status === 'PENDING') ?? null;
  const subdivision = loc.subdivision.trim();
  const ready = loc.region.trim().length > 0 && loc.division.trim().length > 0 && subdivision.length > 0;

  // Does this subdivision already have a representative? Then only a quarter within it can be asked for.
  useEffect(() => {
    setTaken(null);
    if (fixedArea || !ready) return;
    let live = true;
    const q = `country=${encodeURIComponent(locationCountry(loc))}&region=${encodeURIComponent(loc.region.trim())}&division=${encodeURIComponent(loc.division.trim())}&subdivision=${encodeURIComponent(subdivision)}`;
    api
      .get<{ represented: boolean; representatives: string[] }>(`/api/member/leadership-directory/subdivision-status?${q}`)
      .then((r) => live && setTaken(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fixedArea, ready, subdivision, loc.division, loc.region]); // eslint-disable-line react-hooks/exhaustive-deps
  const takenAlready = Boolean(taken?.represented);
  const wantsQuarter = scope === 'QUARTER' || takenAlready;

  const canSend = fixedArea ? true : ready && (!wantsQuarter || loc.quarter.trim().length > 0);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/member/area-representation-requests', {
        ...(fixedArea
          ? { areaId: fixedArea.id }
          : {
              typedCountry: locationCountry(loc),
              typedRegion: loc.region.trim(),
              typedDivision: loc.division.trim(),
              typedSubdivision: subdivision,
              typedQuarter: wantsQuarter ? loc.quarter.trim() : undefined,
            }),
        note: note.trim() || undefined,
      });
      setSent(true);
      setOpen(false);
      setLoc(locationFrom({ country }));
      setScope('SUBDIVISION');
      setNote('');
      onClearFixedArea?.();
      loadMine();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'SUBDIVISION_TAKEN'
          ? t('leadershipDirectory.taken_refused')
          : err instanceof ApiError && err.status === 409
            ? t('leadershipDirectory.already_pending')
            : t('leadershipDirectory.geo_submit_failed'),
      );
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

  const takenNotice = takenAlready ? (
    <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status" data-testid="subdivision-taken">
      {t('leadershipDirectory.subdivision_taken', { names: taken!.representatives.join(', ') })}
    </p>
  ) : null;

  // What to represent: asked right under the subdivision, before the quarter.
  const scopeBox = ready ? (
    <fieldset className="mt-2 space-y-1.5 rounded-lg border border-slate-200 p-3" data-testid="scope">
      <legend className="px-1 text-sm font-semibold text-slate-800">{t('leadershipDirectory.scope_title')}</legend>
      <label className={`flex items-start gap-2 text-sm ${takenAlready ? 'text-slate-400' : 'text-slate-800'}`}>
        <input type="radio" name="scope" className="mt-1 h-4 w-4 accent-emerald-600" checked={!wantsQuarter} disabled={takenAlready} onChange={() => setScope('SUBDIVISION')} />
        <span>{t('leadershipDirectory.scope_subdivision', { name: subdivision })}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="radio" name="scope" className="mt-1 h-4 w-4 accent-emerald-600" checked={wantsQuarter} onChange={() => setScope('QUARTER')} />
        <span>{t('leadershipDirectory.scope_quarter', { name: subdivision })}</span>
      </label>
    </fieldset>
  ) : null;

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
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{t('leadershipDirectory.level_help')}</p>

          {fixedArea ? (
            <p className="rounded-lg bg-brand-50 p-2 text-sm text-brand-900">
              {fixedArea.label}{' '}
              <button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={onClearFixedArea}>
                {t('admin.roleAssignments.change')}
              </button>
            </p>
          ) : (
            <div className="space-y-2">
              <LocationFields
                value={loc}
                onChange={(next) => setLoc(next)}
                idPrefix="typed"
                hideQuarter={!wantsQuarter}
                hints={{
                  subdivision: (
                    <>
                      <p className="mt-1 text-xs text-slate-600">{t('leadershipDirectory.subdivision_hint')}</p>
                      {takenNotice}
                      {scopeBox}
                    </>
                  ),
                  quarter: <p className="mt-1 text-xs text-slate-600">{t('leadershipDirectory.quarter_hint')}</p>,
                }}
              />

              {ready && (
                <p className="rounded-lg bg-brand-50 p-2 text-sm text-brand-900" data-testid="asking-for">
                  {t('leadershipDirectory.asking_for')}{' '}
                  <strong>
                    {wantsQuarter
                      ? `${t('leadershipDirectory.level_quarter')} — ${loc.quarter.trim() || '…'} (${subdivision})`
                      : `${t('leadershipDirectory.level_subdivision')} — ${subdivision}`}
                  </strong>
                </p>
              )}
            </div>
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
                onCancel?.();
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
