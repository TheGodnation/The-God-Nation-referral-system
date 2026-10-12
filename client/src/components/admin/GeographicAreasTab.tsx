import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

type GeographicLevel = 'NATIONAL' | 'REGION' | 'DIVISION' | 'SUBDIVISION' | 'QUARTER';

interface AreaNode {
  id: string;
  parentId: string | null;
  name: string;
  level: GeographicLevel;
  country: string;
  title?: string;
  _count?: { children: number };
  leadershipAssignments: { id: string; person: { id: string; name: string } }[];
}

const LEVEL_LABEL_KEY: Record<GeographicLevel, string> = {
  NATIONAL: 'level_national',
  REGION: 'level_region',
  DIVISION: 'level_division',
  SUBDIVISION: 'level_subdivision',
  QUARTER: 'level_quarter',
};

// Phase 6 — Geographical Leadership Directory: the area tree (Country ->
// Region -> Division -> Subdivision -> Quarter), browsed one level at a
// time via a breadcrumb (same pattern as CommunitiesTab), plus assigning/
// ending a Person's leadership of the currently browsed area. A level is
// always derived server-side from the parent — this screen never lets
// Admin type or pick a level directly, matching the "do not label every
// leader a regional leader" requirement.
export function GeographicAreasTab() {
  const { t } = useTranslation();
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string; level: GeographicLevel }[]>([]);
  const [items, setItems] = useState<AreaNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [assigningAreaId, setAssigningAreaId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const parent = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : null;

  function load() {
    const query = parent ? `parentId=${parent.id}` : '';
    api
      .get<{ items: AreaNode[] }>(`/api/admin/geographic-areas?${query}&pageSize=100`)
      .then((res) => setItems(res.items))
      .catch(() => setError(t('admin.geographicAreas.load_failed')));
  }

  useEffect(load, [parent?.id]);

  function openChildren(node: AreaNode) {
    setBreadcrumb((b) => [...b, { id: node.id, name: node.name, level: node.level }]);
    setShowForm(false);
    setRenamingId(null);
  }

  function jumpTo(index: number) {
    setBreadcrumb((b) => b.slice(0, index + 1));
    setShowForm(false);
    setRenamingId(null);
  }

  async function createArea() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/api/admin/geographic-areas', { parentId: parent?.id ?? null, name: name.trim() });
      setName('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.geographicAreas.create_failed'));
    } finally {
      setCreating(false);
    }
  }

  async function rename(id: string) {
    if (!renameValue.trim()) return;
    try {
      await api.patch(`/api/admin/geographic-areas/${id}`, { name: renameValue.trim() });
      setRenamingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.geographicAreas.rename_failed'));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('admin.geographicAreas.delete_confirm') ?? '')) return;
    try {
      await api.delete(`/api/admin/geographic-areas/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.geographicAreas.delete_failed'));
    }
  }

  async function assignLeader(areaId: string, person: { id: string; name: string }) {
    setAssignError(null);
    try {
      await api.post('/api/admin/area-leadership-assignments', { personId: person.id, areaId });
      setAssigningAreaId(null);
      load();
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : t('admin.geographicAreas.assign_failed'));
    }
  }

  async function endAssignment(assignmentId: string) {
    if (!window.confirm(t('admin.geographicAreas.end_confirm') ?? '')) return;
    try {
      await api.patch(`/api/admin/area-leadership-assignments/${assignmentId}/end`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.geographicAreas.end_failed'));
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.geographicAreas.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {parent ? t('admin.geographicAreas.new_sub_area') : t('admin.geographicAreas.new_country')}
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">{t('admin.geographicAreas.description')}</p>

      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-500">
        <button className={!parent ? 'font-semibold text-brand-900' : 'hover:underline'} onClick={() => setBreadcrumb([])}>
          {t('admin.geographicAreas.countries')}
        </button>
        {breadcrumb.map((b, i) => (
          <Fragment key={b.id}>
            <span>›</span>
            <button className={i === breadcrumb.length - 1 ? 'font-semibold text-brand-900' : 'hover:underline'} onClick={() => jumpTo(i)}>
              {b.name}
            </button>
          </Fragment>
        ))}
      </nav>

      {showForm && (
        <div className="card mb-4 space-y-3">
          <label className="label">{parent ? t('admin.geographicAreas.sub_area_name_label') : t('admin.geographicAreas.country_name_label')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.geographicAreas.name_placeholder') ?? ''} />
          <div className="flex gap-3">
            <button type="button" className="btn-primary" disabled={!name.trim() || creating} onClick={createArea}>
              {t('admin.geographicAreas.create')}
            </button>
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setShowForm(false)}>
              {t('admin.leaders.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.geographicAreas.table_name')}</th>
              <th className="py-2 pr-4">{t('admin.geographicAreas.table_level')}</th>
              <th className="py-2 pr-4">{t('admin.geographicAreas.table_leader')}</th>
              <th className="py-2 pr-4">{t('admin.geographicAreas.table_action')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 align-top">
                <td className="py-2 pr-4">
                  {renamingId === a.id ? (
                    <div className="flex items-center gap-2">
                      <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                      <button className="text-xs text-brand-700 hover:underline" onClick={() => rename(a.id)}>
                        {t('admin.geographicAreas.save')}
                      </button>
                      <button className="text-xs text-slate-500 hover:underline" onClick={() => setRenamingId(null)}>
                        {t('admin.leaders.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button className="font-medium text-brand-900 hover:underline" onClick={() => openChildren(a)}>
                      {a.name}
                    </button>
                  )}
                </td>
                <td className="py-2 pr-4">{t(`admin.geographicAreas.${LEVEL_LABEL_KEY[a.level]}`)}</td>
                <td className="py-2 pr-4">
                  {a.leadershipAssignments.length > 0 ? (
                    <ul className="space-y-1">
                      {a.leadershipAssignments.map((la) => (
                        <li key={la.id} className="flex items-center gap-2">
                          <span>{la.person.name}</span>
                          <button className="text-xs text-red-700 hover:underline" onClick={() => endAssignment(la.id)}>
                            {t('admin.geographicAreas.end')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-slate-400">{t('admin.geographicAreas.vacant')}</span>
                  )}
                  {assigningAreaId === a.id && (
                    <div className="mt-2">
                      {assignError && <p className="mb-1 text-xs text-red-700">{assignError}</p>}
                      <SearchPicker
                        placeholder={t('admin.roleAssignments.search_person_placeholder') ?? ''}
                        searchPath="/api/admin/people?search="
                        renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                        actionLabel={t('admin.roleAssignments.select')}
                        searchButtonLabel={t('admin.people.search_button')}
                        onPick={(p) => assignLeader(a.id, { id: p.id, name: p.name })}
                      />
                      <button className="mt-1 text-xs text-slate-500 hover:underline" onClick={() => setAssigningAreaId(null)}>
                        {t('admin.leaders.cancel')}
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <div className="flex flex-wrap gap-2">
                    <button className="text-xs text-brand-700 hover:underline" onClick={() => { setAssigningAreaId(a.id); setAssignError(null); }}>
                      {t('admin.geographicAreas.assign_leader')}
                    </button>
                    <button
                      className="text-xs text-slate-500 hover:underline"
                      onClick={() => {
                        setRenamingId(a.id);
                        setRenameValue(a.name);
                      }}
                    >
                      {t('admin.geographicAreas.rename')}
                    </button>
                    {(a._count?.children ?? 0) === 0 && a.leadershipAssignments.length === 0 && (
                      <button className="text-xs text-red-700 hover:underline" onClick={() => remove(a.id)}>
                        {t('admin.geographicAreas.delete')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  {parent ? t('admin.geographicAreas.no_sub_areas') : t('admin.geographicAreas.no_countries')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
