import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { loadLeaflet } from '../../lib/loadLeaflet';
import { CAMEROON_CENTER, COUNTRY_POINTS, REGION_POINTS, pointFor } from '../../lib/mapPoints';
import { CAMEROON_REGIONS, COUNTRIES, optionLabel } from '../../lib/locations';
import { SearchPicker } from './SearchPicker';

// Admin member map: where members live, so the central authority can
// decide where to create location-based groups. Bubbles on the map show
// how many members are in each Cameroon region (or each country, in the
// world view); the list beside it goes down to division, subdivision and
// quarter. Counts only — no names, no individual positions.

export interface PlaceNode {
  name: string;
  count: number;
  children: PlaceNode[];
}

interface MapData {
  total: number;
  withoutLocation: number;
  countries: PlaceNode[];
}

type View = 'cameroon' | 'world';

function translatedName(name: string, level: number, language: string) {
  // level 0 = country, level 1 = Cameroon region; deeper levels are typed by members.
  const list = level === 0 ? COUNTRIES : level === 1 ? CAMEROON_REGIONS : null;
  const option = list?.find((o) => o.value.toLowerCase() === name.toLowerCase());
  return option ? optionLabel(option, language) : name;
}

function CreateGroupForm({ country, region, onDone }: { country: string; region: string | null; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const placeLabel = region ? translatedName(region, 1, i18n.language) : translatedName(country, 0, i18n.language);
  const [name, setName] = useState(t('admin.memberMap.default_group_name', { place: placeLabel }));
  const [parent, setParent] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('admin.memberMap.need_name'));
    if (!parent) return setError(t('admin.memberMap.need_parent'));
    setSaving(true);
    try {
      await api.post('/api/admin/communities', {
        name: name.trim(),
        parentId: parent.id,
        placementCountry: country,
        placementRegion: region,
      });
      setCreated(name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.memberMap.create_failed'));
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div role="status" className="space-y-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
        <p>{t('admin.memberMap.created', { name: created, place: placeLabel })}</p>
        <p>{t('admin.memberMap.created_hint')}</p>
        <button type="button" className="underline" onClick={onDone}>
          {t('admin.memberMap.close')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <p className="text-sm text-slate-600">{t('admin.memberMap.create_help', { place: placeLabel })}</p>
      <div>
        <label className="label" htmlFor="map-group-name">
          {t('admin.memberMap.group_name')}
        </label>
        <input id="map-group-name" className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <p className="label">{t('admin.memberMap.parent_group')}</p>
        <p className="mb-2 text-sm text-slate-600">{parent ? parent.name : t('admin.memberMap.no_parent')}</p>
        <SearchPicker
          placeholder={t('admin.memberMap.search_parent') ?? ''}
          searchPath="/api/admin/communities?search="
          renderLabel={(c) => c.name}
          actionLabel={t('admin.memberMap.select')}
          searchButtonLabel={t('admin.memberMap.search')}
          onPick={(c) => setParent({ id: c.id, name: c.name })}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {t('admin.memberMap.create')}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          {t('admin.memberMap.cancel')}
        </button>
      </div>
    </form>
  );
}

export function MemberMapTab({ includeTestData }: { includeTestData: boolean }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('cameroon');
  // Names from country downwards, e.g. ['Cameroon', 'Centre', 'Mfoundi'].
  const [path, setPath] = useState<string[]>(['Cameroon']);
  const [creating, setCreating] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const mapBox = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    // The map's container disappears while loading, so start a fresh map.
    mapRef.current?.remove();
    mapRef.current = null;
    setData(null);
    setError(null);
    api
      .get<MapData>(`/api/admin/location-map?includeTestData=${includeTestData}`)
      .then(setData)
      .catch(() => setError(t('admin.memberMap.load_failed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeTestData]);

  const cameroon = data?.countries.find((c) => c.name.toLowerCase() === 'cameroon') ?? null;
  const outside = data?.countries.filter((c) => c !== cameroon) ?? [];
  const outsideTotal = outside.reduce((sum, c) => sum + c.count, 0);

  // Draw (or redraw) the bubbles whenever the data or the view changes.
  useEffect(() => {
    if (!data || !mapBox.current) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapBox.current) return;
        if (!mapRef.current) {
          mapRef.current = L.map(mapBox.current, { scrollWheelZoom: false });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 12,
            attribution: '&copy; OpenStreetMap contributors',
          }).addTo(mapRef.current);
          layerRef.current = L.layerGroup().addTo(mapRef.current);
        }
        layerRef.current.clearLayers();

        const cameroonNode = data.countries.find((c) => c.name.toLowerCase() === 'cameroon');
        const points =
          view === 'cameroon'
            ? (cameroonNode?.children ?? []).map((r) => ({ node: r, at: pointFor(REGION_POINTS, r.name), level: 1 }))
            : (data.countries ?? []).map((c) => ({ node: c, at: pointFor(COUNTRY_POINTS, c.name), level: 0 }));
        const max = Math.max(1, ...points.map((p) => p.node.count));

        for (const p of points) {
          if (!p.at) continue;
          const radius = 8 + 32 * Math.sqrt(p.node.count / max);
          const label = `${translatedName(p.node.name, p.level, i18n.language)}: ${p.node.count}`;
          L.circleMarker(p.at, { radius, color: '#16349a', weight: 1, fillColor: '#2a5cf0', fillOpacity: 0.55 })
            .bindTooltip(label, { permanent: view === 'cameroon', direction: 'top' })
            .on('click', () => {
              setCreating(false);
              setPath(view === 'cameroon' ? ['Cameroon', p.node.name] : [p.node.name]);
            })
            .addTo(layerRef.current);
        }

        if (view === 'cameroon') mapRef.current.setView(CAMEROON_CENTER, 6);
        else mapRef.current.setView([15, 10], 2);
      })
      .catch(() => !cancelled && setMapFailed(true));
    return () => {
      cancelled = true;
    };
  }, [data, view, i18n.language]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  function switchView(next: View) {
    setView(next);
    setCreating(false);
    setPath(next === 'cameroon' ? ['Cameroon'] : []);
  }

  // The list beside the map follows `path` down the tree.
  let nodes: PlaceNode[] = data?.countries ?? [];
  let current: PlaceNode | null = null;
  for (const name of path) {
    const found = nodes.find((n) => n.name.toLowerCase() === name.toLowerCase());
    if (!found) break;
    current = found;
    nodes = found.children;
  }
  const depth = path.length; // 0 = countries, 1 = regions (Cameroon) or cities, 2 = divisions…
  const isCameroonPath = path[0]?.toLowerCase() === 'cameroon';
  // A group can be tagged by country, or by Cameroon region.
  const canCreateHere = current !== null && (depth === 1 || (isCameroonPath && depth === 2));

  const levelTitle = (() => {
    if (depth === 0) return t('admin.memberMap.level_countries');
    if (!isCameroonPath) return t('admin.memberMap.level_cities');
    return [
      '',
      t('admin.memberMap.level_regions'),
      t('admin.memberMap.level_divisions'),
      t('admin.memberMap.level_subdivisions'),
      t('admin.memberMap.level_quarters'),
    ][depth];
  })();
  const maxHere = Math.max(1, ...nodes.map((n) => n.count));

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-slate-400">{t('admin.memberMap.loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-slate-500">{t('admin.memberMap.stat_total')}</p>
          <p className="text-2xl font-bold text-brand-900">{data.total}</p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-500">{t('admin.memberMap.stat_cameroon')}</p>
          <p className="text-2xl font-bold text-brand-900">{cameroon?.count ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-500">{t('admin.memberMap.stat_outside')}</p>
          <p className="text-2xl font-bold text-brand-900">{outsideTotal}</p>
        </div>
      </div>
      {data.withoutLocation > 0 && (
        <p className="text-sm text-slate-500">{t('admin.memberMap.without_location', { count: data.withoutLocation })}</p>
      )}

      <div className="flex gap-2">
        <button type="button" className={view === 'cameroon' ? 'btn-primary' : 'btn-secondary'} onClick={() => switchView('cameroon')}>
          {t('admin.memberMap.view_cameroon')}
        </button>
        <button type="button" className={view === 'world' ? 'btn-primary' : 'btn-secondary'} onClick={() => switchView('world')}>
          {t('admin.memberMap.view_world')}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card p-0 lg:col-span-3">
          {mapFailed ? (
            <p className="p-4 text-sm text-slate-500">{t('admin.memberMap.map_unavailable')}</p>
          ) : (
            <div ref={mapBox} className="h-[420px] w-full rounded-xl" aria-label={t('admin.memberMap.map_label') ?? ''} />
          )}
        </div>

        <div className="card space-y-3 lg:col-span-2">
          <nav aria-label={t('admin.memberMap.breadcrumb_label') ?? ''} className="flex flex-wrap items-center gap-1 text-sm">
            <button type="button" className="text-brand-700 hover:underline" onClick={() => { setPath([]); setCreating(false); }}>
              {t('admin.memberMap.all_countries')}
            </button>
            {path.map((name, i) => (
              <span key={`${name}-${i}`} className="flex items-center gap-1">
                <span className="text-slate-300">/</span>
                <button
                  type="button"
                  className={i === path.length - 1 ? 'font-semibold text-brand-900' : 'text-brand-700 hover:underline'}
                  onClick={() => {
                    setPath(path.slice(0, i + 1));
                    setCreating(false);
                  }}
                >
                  {translatedName(name, i, i18n.language)}
                </button>
              </span>
            ))}
          </nav>

          {current && (
            <p className="text-sm text-slate-600">
              {t('admin.memberMap.members_here', { count: current.count, place: translatedName(current.name, depth - 1, i18n.language) })}
            </p>
          )}

          {canCreateHere && !creating && (
            <button type="button" className="btn-secondary w-full" onClick={() => setCreating(true)}>
              ＋ {t('admin.memberMap.create_here')}
            </button>
          )}
          {canCreateHere && creating && current && (
            <CreateGroupForm
              country={path[0]}
              region={isCameroonPath && depth === 2 ? current.name : null}
              onDone={() => setCreating(false)}
            />
          )}

          {nodes.length > 0 && (
            <>
              <h3 className="font-semibold text-brand-900">{levelTitle}</h3>
              <ul className="space-y-2">
                {nodes.map((n) => {
                  const canGoDeeper = n.children.length > 0;
                  const label = translatedName(n.name, depth, i18n.language);
                  return (
                    <li key={n.name}>
                      <button
                        type="button"
                        className="w-full text-left disabled:cursor-default"
                        disabled={!canGoDeeper}
                        onClick={() => {
                          setPath([...path, n.name]);
                          setCreating(false);
                        }}
                      >
                        <div className="flex justify-between text-sm">
                          <span className={canGoDeeper ? 'text-brand-700' : 'text-slate-700'}>{label}</span>
                          <span className="font-semibold text-slate-800">{n.count}</span>
                        </div>
                        <div className="mt-1 h-2 w-full rounded bg-slate-100">
                          <div className="h-2 rounded bg-brand-500" style={{ width: `${Math.round((n.count / maxHere) * 100)}%` }} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {nodes.length === 0 && current === null && <p className="text-sm text-slate-500">{t('admin.memberMap.empty')}</p>}
        </div>
      </div>
    </div>
  );
}
