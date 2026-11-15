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

interface SubdivisionStatus {
  represented: boolean;
  count?: number;
  seats?: number;
  full?: boolean;
  nextSeat?: number | null;
  representatives: string[];
}

// Seat 1 is the Representative; seats 2 to 5 are the first to fourth Assistant Representative.
const ROLE_KEYS = ['representative', 'assistant_1', 'assistant_2', 'assistant_3', 'assistant_4'];
const isQuarterRequest = (r: MyRequestRow) => (r.area ? r.area.level === 'QUARTER' : Boolean(r.typedQuarter));

const requestPlace = (r: MyRequestRow) =>
  r.area ? r.area.name : [r.typedQuarter, r.typedSubdivision, r.typedDivision, r.typedRegion, r.typedCountry].filter(Boolean).join(', ');

// "Represent The God Nation in your area". The member names where they live from the lists (country, region,
// division, then the exact subdivision) and says what they want to represent: a seat in the subdivision (a
// subdivision has five representatives: the first free seat goes to the next person approved), or one quarter
// within it. When the five seats are taken, only a quarter can be asked for. A person can hold a seat AND one
// quarter, never two quarters. Regions and divisions are appointed by the central authority. The central
// authority reviews the request and contacts them; nothing is granted by sending it.
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
  const [taken, setTaken] = useState<SubdivisionStatus | null>(null);
  const [representsQuarter, setRepresentsQuarter] = useState(false);

  function loadMine() {
    api
      .get<{ items: MyRequestRow[] }>('/api/member/area-representation-requests/mine')
      .then((res) => setMyRequests(res.items))
      .catch(() => setMyRequests([]));
  }
  useEffect(loadMine, []);
  useEffect(() => {
    api
      .get<{ representsQuarter: boolean }>('/api/member/leadership-directory/my-quarter')
      .then((r) => setRepresentsQuarter(r.representsQuarter))
      .catch(() => undefined);
  }, []);

  // A place chosen elsewhere opens the form with that place already set.
  useEffect(() => {
    if (fixedArea) setOpen(true);
  }, [fixedArea]);

  // One waiting request for a seat in a subdivision and one for a quarter: a person can hold both kinds of position.
  const pendingSeat = myRequests?.find((r) => r.status === 'PENDING' && !isQuarterRequest(r)) ?? null;
  const pendingQuarter = myRequests?.find((r) => r.status === 'PENDING' && isQuarterRequest(r)) ?? null;
  const pendingList = [pendingSeat, pendingQuarter].filter((r): r is MyRequestRow => r !== null);
  const quarterClosed = representsQuarter || Boolean(pendingQuarter);
  const subdivision = loc.subdivision.trim();
  const ready = loc.region.trim().length > 0 && loc.division.trim().length > 0 && subdivision.length > 0;

  // Does this subdivision already have a representative? Then only a quarter within it can be asked for.
  useEffect(() => {
    setTaken(null);
    if (fixedArea || !ready) return;
    let live = true;
    const q = `country=${encodeURIComponent(locationCountry(loc))}&region=${encodeURIComponent(loc.region.trim())}&division=${encodeURIComponent(loc.division.trim())}&subdivision=${encodeURIComponent(subdivision)}`;
    api
      .get<SubdivisionStatus>(`/api/member/leadership-directory/subdivision-status?${q}`)
      .then((r) => live && setTaken(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fixedArea, ready, subdivision, loc.division, loc.region]); // eslint-disable-line react-hooks/exhaustive-deps
  // All five seats taken (or a seat already asked for): only a quarter is left to ask for.
  const takenAlready = Boolean(taken?.full) || Boolean(pendingSeat);
  const wantsQuarter = (scope === 'QUARTER' || takenAlready) && !quarterClosed;
  const nothingToAsk = takenAlready && quarterClosed;

  const canSend = fixedArea ? true : ready && !nothingToAsk && (!wantsQuarter || loc.quarter.trim().length > 0);

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
        err instanceof ApiError && (err.code === 'SUBDIVISION_FULL' || err.code === 'SUBDIVISION_TAKEN')
          ? t('leadershipDirectory.taken_refused')
          : err instanceof ApiError && err.code === 'ALREADY_QUARTER'
            ? t('leadershipDirectory.already_quarter')
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

  const seatsTaken = taken?.count ?? 0;
  const seatTotal = taken?.seats ?? 5;
  const takenNotice = taken?.full ? (
    <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status" data-testid="subdivision-taken">
      {t('leadershipDirectory.seats_full', { seats: seatTotal, names: taken.representatives.join(', ') })}
    </p>
  ) : seatsTaken > 0 && taken?.nextSeat ? (
    <p className="mt-1 rounded-lg bg-brand-50 p-2 text-sm text-brand-900" role="status" data-testid="subdivision-seats">
      {t('leadershipDirectory.seats_some', { count: seatsTaken, seats: seatTotal, names: taken.representatives.join(', '), role: t(`leadershipDirectory.role_${ROLE_KEYS[taken.nextSeat - 1] ?? 'representative'}`) })}
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
      <label className={`flex items-start gap-2 text-sm ${quarterClosed ? 'text-slate-400' : 'text-slate-800'}`}>
        <input type="radio" name="scope" className="mt-1 h-4 w-4 accent-emerald-600" checked={wantsQuarter} disabled={quarterClosed} onChange={() => setScope('QUARTER')} />
        <span>{t('leadershipDirectory.scope_quarter', { name: subdivision })}</span>
      </label>
      {quarterClosed && (
        <p className="text-xs text-slate-600" data-testid="quarter-closed">
          {representsQuarter ? t('leadershipDirectory.already_quarter') : t('leadershipDirectory.quarter_waiting')}
        </p>
      )}
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

      {pendingList.length > 0 && (
        <div className="space-y-2">
          {pendingList.map((r) => (
            <div key={r.id} className="rounded-lg bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-800">{requestPlace(r)}</p>
              <p className="mt-1 text-amber-700">{t('leadershipDirectory.status_pending')}</p>
              <button type="button" className="mt-2 text-xs text-red-700 underline" onClick={() => void withdraw(r.id)}>
                {t('leadershipDirectory.withdraw')}
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingList.length === 2 || (pendingList.length === 1 && representsQuarter && !pendingQuarter) ? null : !open ? (
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
