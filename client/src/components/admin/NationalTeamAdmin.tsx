import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface TeamRow {
  id: string;
  title: string;
  sortOrder: number;
  person: { id: string; name: string; whatsappNumber: string };
}

// The National Team shown at the top of the members' Leadership Directory:
// the admin picks a person, gives them a title, and can reorder or remove
// them. No area is needed.
export function NationalTeamAdmin() {
  const { t } = useTranslation();
  const [items, setItems] = useState<TeamRow[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: TeamRow[] }>('/api/admin/national-team')
      .then((res) => setItems(res.items))
      .catch(() => setError(t('admin.nationalTeam.load_failed')));
  }
  useEffect(load, []);

  async function add() {
    if (!picked || !title.trim()) return;
    setError(null);
    try {
      await api.post('/api/admin/national-team', { personId: picked.id, title: title.trim(), sortOrder: items.length + 1 });
      setPicked(null);
      setTitle('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.nationalTeam.add_failed'));
    }
  }

  async function retitle(row: TeamRow) {
    const next = window.prompt(t('admin.nationalTeam.title_prompt') ?? '', row.title);
    if (!next?.trim() || next.trim() === row.title) return;
    try {
      await api.patch(`/api/admin/national-team/${row.id}`, { title: next.trim() });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.nationalTeam.update_failed'));
    }
  }

  async function move(row: TeamRow, delta: -1 | 1) {
    const index = items.findIndex((r) => r.id === row.id);
    const other = items[index + delta];
    if (!other) return;
    try {
      // Swap the two places in the order.
      await Promise.all([
        api.patch(`/api/admin/national-team/${row.id}`, { sortOrder: index + delta }),
        api.patch(`/api/admin/national-team/${other.id}`, { sortOrder: index }),
      ]);
      load();
    } catch {
      setError(t('admin.nationalTeam.update_failed'));
    }
  }

  async function remove(row: TeamRow) {
    if (!window.confirm(t('admin.nationalTeam.remove_confirm', { name: row.person.name }) ?? '')) return;
    try {
      await api.delete(`/api/admin/national-team/${row.id}`);
      load();
    } catch {
      setError(t('admin.nationalTeam.update_failed'));
    }
  }

  return (
    <section className="card mb-6 space-y-3">
      <div>
        <h3 className="font-semibold text-brand-900">{t('admin.nationalTeam.title')}</h3>
        <p className="text-sm text-slate-500">{t('admin.nationalTeam.description')}</p>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}

      {items.length > 0 ? (
        <ol className="divide-y divide-slate-100 text-sm">
          {items.map((row, i) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-900">{row.person.name}</span> <span className="text-slate-500">— {row.title}</span>
              </span>
              <button type="button" className="text-xs text-slate-500 hover:underline" disabled={i === 0} aria-label={t('admin.nationalTeam.move_up') ?? ''} onClick={() => void move(row, -1)}>
                ↑
              </button>
              <button type="button" className="text-xs text-slate-500 hover:underline" disabled={i === items.length - 1} aria-label={t('admin.nationalTeam.move_down') ?? ''} onClick={() => void move(row, 1)}>
                ↓
              </button>
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => void retitle(row)}>
                {t('admin.nationalTeam.change_title')}
              </button>
              <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void remove(row)}>
                {t('admin.nationalTeam.remove')}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-400">{t('admin.nationalTeam.empty')}</p>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <h4 className="text-sm font-medium text-slate-800">{t('admin.nationalTeam.add_title')}</h4>
        {picked ? (
          <p className="text-sm text-brand-900">
            {picked.name}{' '}
            <button type="button" className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setPicked(null)}>
              {t('admin.roleAssignments.change')}
            </button>
          </p>
        ) : (
          <SearchPicker
            placeholder={t('admin.roleAssignments.search_person_placeholder') ?? ''}
            searchPath="/api/admin/people?search="
            renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
            actionLabel={t('admin.roleAssignments.select')}
            searchButtonLabel={t('admin.people.search_button')}
            onPick={(p) => setPicked({ id: p.id, name: p.name })}
          />
        )}
        <input
          className="input"
          maxLength={80}
          aria-label={t('admin.nationalTeam.title_label') ?? ''}
          placeholder={t('admin.nationalTeam.title_placeholder') ?? ''}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="button" className="btn-primary px-4 py-2" disabled={!picked || !title.trim()} onClick={() => void add()}>
          {t('admin.nationalTeam.add')}
        </button>
      </div>
    </section>
  );
}
