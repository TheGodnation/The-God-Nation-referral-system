import { useState } from 'react';
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
}: {
  placeholder: string;
  searchPath: string;
  renderLabel: (item: any) => string;
  actionLabel: string;
  searchButtonLabel: string;
  onPick: (item: any) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');

  async function search() {
    if (!query.trim()) return;
    const res = await api.get<{ items: any[] }>(`${searchPath}${encodeURIComponent(query)}`);
    setResults(res.items);
    setSelectedId('');
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
