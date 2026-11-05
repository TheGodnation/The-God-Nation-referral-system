import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

// Small search-then-pick control shared across Phase 3A/3B admin flows
// (assigning a Person to a Geography/Community, selecting a Person to
// start an Assessment attempt) — searches a small, bounded result set
// (max ~20 items server-side) rather than rendering a heavy picker or
// loading an entire list.
export function SearchPicker({
  placeholder,
  searchPath,
  renderLabel,
  actionLabel,
  searchButtonLabel,
  onPick,
  renderExtra,
}: {
  placeholder: string;
  searchPath: string;
  renderLabel: (item: any) => string;
  actionLabel: string;
  searchButtonLabel: string;
  onPick: (item: any) => void;
  /** Something to say about the whole answer (for example, matches that cannot be picked yet). */
  renderExtra?: (response: any) => ReactNode;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [response, setResponse] = useState<any>(null);
  // After a search: how it ended, so an empty result is said out loud, not left as a silent blank.
  const [outcome, setOutcome] = useState<'none' | 'failed' | null>(null);

  async function search() {
    if (!query.trim()) return;
    setOutcome(null);
    try {
      const res = await api.get<{ items: any[] }>(`${searchPath}${encodeURIComponent(query)}`);
      setResponse(res);
      setResults(res.items);
      setSelectedId('');
      if (res.items.length === 0) setOutcome('none');
    } catch {
      setResponse(null);
      setResults([]);
      setOutcome('failed');
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            search();
          }
        }}
      />
      <button type="button" className="btn-secondary sm:w-32" onClick={search}>
        {searchButtonLabel}
      </button>
      {outcome && (
        <p className={`text-sm ${outcome === 'failed' ? 'text-red-700' : 'text-slate-600'}`} role="status">
          {outcome === 'failed' ? t('admin.search.failed') : t('admin.search.none')}
        </p>
      )}
      {renderExtra && response ? renderExtra(response) : null}
      {results.length > 0 && (
        <>
          <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">—</option>
            {results.map((r) => (
              <option key={r.id} value={r.id}>
                {renderLabel(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary sm:w-32"
            disabled={!selectedId}
            onClick={() => onPick(results.find((r) => r.id === selectedId))}
          >
            {actionLabel}
          </button>
        </>
      )}
    </div>
  );
}
