import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';
import { api, ApiError } from '../../lib/api';

type GeographicLevel = 'NATIONAL' | 'REGION' | 'DIVISION' | 'SUBDIVISION' | 'QUARTER';

interface CountryRow {
  id: string;
  name: string;
  country: string;
}

interface AreaEntry {
  id: string;
  name: string;
  level: GeographicLevel;
  title: string;
  path: string;
  leaders: { personId: string; name: string; photoUrl: string | null }[];
}

interface AreaSearchResult {
  id: string;
  name: string;
  level: GeographicLevel;
  title: string;
  leaders: { personId: string; name: string }[];
}

interface MyRequestRow {
  id: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decisionNote: string | null;
  area: { id: string; name: string; level: GeographicLevel };
}

const LEVELS: GeographicLevel[] = ['NATIONAL', 'REGION', 'DIVISION', 'SUBDIVISION', 'QUARTER'];

// The Geographical Leadership Directory — a visual, scrollable card row
// (same spirit as the Home page's MemberPhotoSlider "people discovery"
// strip, but each card already shows position and area, so a member never
// has to open a profile just to identify who represents their area), with
// country/level navigation, a clear "no representative yet" list for
// vacant areas, and a member's own "request to represent an area" form.
export function GeographicDirectory() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [countries, setCountries] = useState<CountryRow[] | null>(null);
  const [country, setCountry] = useState<string>('');
  const [level, setLevel] = useState<'' | GeographicLevel>('');
  const [areas, setAreas] = useState<AreaEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<AreaSearchResult[] | null>(null);
  const [selectedArea, setSelectedArea] = useState<AreaSearchResult | null>(null);
  const [note, setNote] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [myRequests, setMyRequests] = useState<MyRequestRow[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: CountryRow[] }>('/api/member/geographic-areas/countries')
      .then((res) => {
        setCountries(res.items);
        if (res.items.length > 0) setCountry(res.items[0].country);
      })
      .catch(() => setCountries([]));
    loadMyRequests();
  }, []);

  function loadMyRequests() {
    api
      .get<{ items: MyRequestRow[] }>('/api/member/area-representation-requests/mine')
      .then((res) => setMyRequests(res.items))
      .catch(() => setMyRequests([]));
  }

  useEffect(() => {
    if (!country) {
      setAreas(null);
      return;
    }
    setLoadError(false);
    const q = level ? `&level=${level}` : '';
    api
      .get<{ items: AreaEntry[] }>(`/api/member/leadership-directory/areas?country=${encodeURIComponent(country)}${q}`)
      .then((res) => setAreas(res.items))
      .catch(() => setLoadError(true));
  }, [country, level]);

  const represented = (areas ?? []).filter((a) => a.leaders.length > 0);
  const vacant = (areas ?? []).filter((a) => a.leaders.length === 0);
  const pendingRequest = myRequests?.find((r) => r.status === 'PENDING') ?? null;

  async function runSearch() {
    if (search.trim().length < 2) return;
    try {
      const res = await api.get<{ items: AreaSearchResult[] }>(`/api/member/geographic-areas?search=${encodeURIComponent(search.trim())}`);
      setSearchResults(res.items);
    } catch {
      setSearchResults([]);
    }
  }

  async function submitRequest() {
    if (!selectedArea) return;
    setRequestError(null);
    setSubmitting(true);
    try {
      await api.post('/api/member/area-representation-requests', { areaId: selectedArea.id, note: note.trim() || undefined });
      setSelectedArea(null);
      setSearch('');
      setSearchResults(null);
      setNote('');
      loadMyRequests();
    } catch (err) {
      setRequestError(err instanceof ApiError && err.status === 409 ? t('leadershipDirectory.already_pending') : t('leadershipDirectory.geo_submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function withdrawRequest(id: string) {
    if (!window.confirm(t('leadershipDirectory.withdraw_confirm') ?? '')) return;
    try {
      await api.delete(`/api/member/area-representation-requests/${id}`);
      loadMyRequests();
    } catch {
      setRequestError(t('leadershipDirectory.withdraw_failed'));
    }
  }

  if (countries !== null && countries.length === 0) return null;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold text-brand-900">{t('leadershipDirectory.geo_title')}</h2>
        <p className="text-sm text-slate-500">{t('leadershipDirectory.geo_help')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {countries && countries.length > 1 && (
          <select className="input w-auto" value={country} onChange={(e) => setCountry(e.target.value)}>
            {countries.map((c) => (
              <option key={c.id} value={c.country}>
                {c.country}
              </option>
            ))}
          </select>
        )}
        <select className="input w-auto" value={level} onChange={(e) => setLevel(e.target.value as '' | GeographicLevel)}>
          <option value="">{t('leadershipDirectory.geo_all_levels')}</option>
          {LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {t(`admin.geographicAreas.level_${lv.toLowerCase()}`)}
            </option>
          ))}
        </select>
      </div>

      {loadError && <p className="text-sm text-red-700">{t('leadershipDirectory.geo_load_failed')}</p>}

      {areas !== null && (
        <>
          {represented.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {represented.flatMap((a) =>
                a.leaders.map((leader) => (
                  <button
                    key={`${a.id}-${leader.personId}`}
                    type="button"
                    className="flex w-32 shrink-0 flex-col items-center gap-1 rounded-lg border border-slate-100 p-2 text-center"
                    onClick={() => navigate(`/member/people/${leader.personId}`)}
                  >
                    <Avatar name={leader.name} photoUrl={leader.photoUrl} size={56} />
                    <span className="w-full truncate text-xs font-semibold text-slate-800">{leader.name}</span>
                    <span className="w-full truncate text-xs text-brand-700">{a.title}</span>
                    <span className="w-full truncate text-[11px] text-slate-500">{a.path}</span>
                  </button>
                )),
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('leadershipDirectory.geo_none_represented')}</p>
          )}

          {vacant.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('leadershipDirectory.geo_vacant_title')}</h3>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-slate-500">
                {vacant.map((a) => (
                  <li key={a.id}>
                    {a.title} — {a.path}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="border-t border-slate-100 pt-3">
        <h3 className="mb-1 font-medium text-slate-800">{t('leadershipDirectory.geo_request_title')}</h3>
        {pendingRequest ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-800">
              {pendingRequest.area.name} ({t(`admin.geographicAreas.level_${pendingRequest.area.level.toLowerCase()}`)})
            </p>
            <p className="mt-1 text-amber-700">{t('leadershipDirectory.status_pending')}</p>
            <button type="button" className="mt-2 text-xs text-red-700 underline" onClick={() => withdrawRequest(pendingRequest.id)}>
              {t('leadershipDirectory.withdraw')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedArea ? (
              <p className="text-sm text-brand-900">
                {selectedArea.name} ({t(`admin.geographicAreas.level_${selectedArea.level.toLowerCase()}`)}){' '}
                <button type="button" className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setSelectedArea(null)}>
                  {t('admin.roleAssignments.change')}
                </button>
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input"
                  placeholder={t('leadershipDirectory.geo_search_placeholder') ?? ''}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={runSearch}>
                  {t('admin.people.search_button')}
                </button>
              </div>
            )}
            {searchResults && !selectedArea && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {searchResults.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setSelectedArea(r); setSearchResults(null); }}>
                      {r.name} <span className="text-xs text-slate-400">({t(`admin.geographicAreas.level_${r.level.toLowerCase()}`)})</span>
                    </button>
                  </li>
                ))}
                {searchResults.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">{t('leadershipDirectory.geo_no_matches')}</li>}
              </ul>
            )}
            {selectedArea && (
              <>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={500}
                  placeholder={t('leadershipDirectory.note_label') ?? ''}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                {requestError && <p className="text-sm text-red-700">{requestError}</p>}
                <button type="button" className="btn-primary px-4 py-2" disabled={submitting} onClick={submitRequest}>
                  {t('leadershipDirectory.submit')}
                </button>
              </>
            )}
          </div>
        )}

        {myRequests && myRequests.some((r) => r.status !== 'PENDING') && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {myRequests
              .filter((r) => r.status !== 'PENDING')
              .map((r) => (
                <li key={r.id} className="py-2">
                  <p className="font-medium text-slate-800">{r.area.name}</p>
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
      </div>
    </section>
  );
}
