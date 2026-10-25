import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';

// For the central admin's member profile ("National Coordinator"), on an
// assembly's info page: add people to it by name, and make a private
// sub-assembly inside it. Same powers as Admin → Communities, from the phone.

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface Found {
  id: string;
  name: string;
  photoUrl: string | null;
  isMember: boolean;
}

function AddPeopleSheet({ communityId, communityName, onClose, onChanged }: { communityId: string; communityName: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Found[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++latest.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      api
        .get<{ items: Found[] }>(`/api/communities/${communityId}/people-search?q=${encodeURIComponent(q)}`)
        .then((r) => mine === latest.current && setResults(r.items))
        .catch(() => mine === latest.current && setResults([]))
        .finally(() => mine === latest.current && setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, communityId]);

  async function add(p: Found) {
    setError(null);
    try {
      await api.post(`/api/communities/${communityId}/members`, { personId: p.id });
      setAdded((s) => new Set(s).add(p.id));
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_MEMBER') setAdded((s) => new Set(s).add(p.id));
      else setError(err instanceof ApiError ? err.message : t('manageAssembly.add_failed'));
    }
  }

  return (
    <Sheet label={t('manageAssembly.add_title', { name: communityName }) ?? ''} onClose={onClose}>
      <h2 className="mb-1 font-semibold text-slate-900">{t('manageAssembly.add_title', { name: communityName })}</h2>
      <p className="mb-2 text-xs text-slate-500">{t('manageAssembly.add_help')}</p>
      <input
        className="input"
        type="search"
        autoFocus
        aria-label={t('manageAssembly.search') ?? ''}
        placeholder={t('manageAssembly.search') ?? ''}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <ul className="mt-2 divide-y divide-slate-100" data-testid="people-results">
        {results.map((p) => {
          const done = p.isMember || added.has(p.id);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Avatar name={p.name} photoUrl={p.photoUrl} size={36} />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{p.name}</span>
              {done ? (
                <span className="text-sm font-medium text-green-700">✓ {added.has(p.id) ? t('manageAssembly.added') : t('manageAssembly.already_in')}</span>
              ) : (
                <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => void add(p)}>
                  {t('manageAssembly.add')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {query.trim().length >= 2 && !searching && results.length === 0 && <p className="mt-3 text-center text-sm text-slate-500">{t('manageAssembly.nobody_found')}</p>}
      <button type="button" className="btn-secondary mt-3 w-full" onClick={onClose}>
        {t('manageAssembly.done')}
      </button>
    </Sheet>
  );
}

function NewSubAssemblySheet({ communityId, communityName, onClose }: { communityId: string; communityName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(await api.post<{ id: string; name: string }>(`/api/communities/${communityId}/sub-assemblies`, { name: name.trim(), aboutEn: about.trim() || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manageAssembly.create_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet label={t('manageAssembly.new_title') ?? ''} onClose={onClose}>
      {created ? (
        <div className="space-y-3 text-center">
          <p className="text-lg font-semibold text-slate-900">✓ {t('manageAssembly.created', { name: created.name })}</p>
          <p className="text-sm text-slate-600">{t('manageAssembly.created_help')}</p>
          <Link to={`/member/chats/group/${created.id}/info`} onClick={onClose} className="btn-primary inline-flex w-full justify-center">
            {t('manageAssembly.open_new')}
          </Link>
          <button type="button" className="btn-secondary w-full" onClick={onClose}>
            {t('manageAssembly.done')}
          </button>
        </div>
      ) : (
        <form onSubmit={create} className="space-y-3">
          <h2 className="font-semibold text-slate-900">{t('manageAssembly.new_title')}</h2>
          <p className="text-xs text-slate-500">{t('manageAssembly.new_help', { name: communityName })}</p>
          <input className="input" aria-label={t('manageAssembly.new_name') ?? ''} placeholder={t('manageAssembly.new_name') ?? ''} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus required />
          <textarea className="input min-h-[4.5rem]" aria-label={t('manageAssembly.new_about') ?? ''} placeholder={t('manageAssembly.new_about') ?? ''} value={about} maxLength={1000} onChange={(e) => setAbout(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>
            {busy ? t('manageAssembly.creating') : t('manageAssembly.create')}
          </button>
          <button type="button" className="btn-secondary w-full" onClick={onClose}>
            {t('manageAssembly.cancel')}
          </button>
        </form>
      )}
    </Sheet>
  );
}

export function ManageAssembly({ communityId, communityName, onMembersChanged }: { communityId: string; communityName: string; onMembersChanged: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<'add' | 'sub' | null>(null);
  return (
    <section className="space-y-2 bg-white px-4 py-4 shadow-sm sm:rounded-xl" data-testid="manage-assembly">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-700">⚙️ {t('manageAssembly.title')}</h3>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={() => setOpen('add')}>
          ＋ {t('manageAssembly.add_people')}
        </button>
        <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={() => setOpen('sub')}>
          ＋ {t('manageAssembly.new_sub')}
        </button>
      </div>
      {open === 'add' && <AddPeopleSheet communityId={communityId} communityName={communityName} onClose={() => setOpen(null)} onChanged={onMembersChanged} />}
      {open === 'sub' && <NewSubAssemblySheet communityId={communityId} communityName={communityName} onClose={() => setOpen(null)} />}
    </section>
  );
}
