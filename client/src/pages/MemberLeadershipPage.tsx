import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { Avatar } from '../components/Avatar';
import { api, ApiError } from '../lib/api';

interface RequestRow {
  id: string;
  label: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decisionNote: string | null;
  createdAt: string;
}

interface DirectoryRow {
  personId: string;
  name: string;
  photoUrl: string | null;
  label: string;
}

// The Leadership Directory: a Member's own "request to represent" an area
// or community (free text, Admin-reviewed), their request history, and the
// public directory of everyone already approved. See RepresentationRequest
// model comment (server) for the deliberately lightweight design.
export function MemberLeadershipPage() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<RequestRow[] | null>(null);
  const [directory, setDirectory] = useState<DirectoryRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<{ items: RequestRow[] }>('/api/member/representation-requests/mine').then((r) => setHistory(r.items)).catch(() => setHistory([]));
    api.get<{ items: DirectoryRow[] }>('/api/member/leadership-directory').then((r) => setDirectory(r.items)).catch(() => setDirectory([]));
  }
  useEffect(load, []);

  const pending = history?.find((r) => r.status === 'PENDING') ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (label.trim().length < 2) {
      setError(t('leadershipDirectory.label_too_short'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/member/representation-requests', { label: label.trim(), note: note.trim() || undefined });
      setLabel('');
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('leadershipDirectory.already_pending') : t('leadershipDirectory.submit_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    if (!window.confirm(t('leadershipDirectory.withdraw_confirm') ?? '')) return;
    try {
      await api.delete(`/api/member/representation-requests/${id}`);
      load();
    } catch {
      setError(t('leadershipDirectory.withdraw_failed'));
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('leadershipDirectory.title')}</h1>
          <Link to="/member/people" className="text-sm text-brand-700 underline">
            {t('leadershipDirectory.back')}
          </Link>
        </div>

        <div className="space-y-6">
          <section className="card space-y-3">
            <h2 className="font-semibold text-brand-900">{t('leadershipDirectory.my_request_title')}</h2>
            <p className="text-sm text-slate-500">{t('leadershipDirectory.my_request_help')}</p>

            {pending ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-800">{pending.label}</p>
                <p className="mt-1 text-amber-700">{t('leadershipDirectory.status_pending')}</p>
                <button type="button" className="mt-2 text-xs text-red-700 underline" onClick={() => withdraw(pending.id)}>
                  {t('leadershipDirectory.withdraw')}
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-2">
                <div>
                  <label className="label">{t('leadershipDirectory.label_label')}</label>
                  <input
                    className="input"
                    maxLength={120}
                    placeholder={t('leadershipDirectory.label_placeholder') ?? ''}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">{t('leadershipDirectory.note_label')}</label>
                  <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {error && <p className="text-sm text-red-700">{error}</p>}
                <button type="submit" className="btn-primary px-4 py-2" disabled={busy}>
                  {t('leadershipDirectory.submit')}
                </button>
              </form>
            )}
          </section>

          {history && history.some((r) => r.status !== 'PENDING') && (
            <section className="card space-y-2">
              <h2 className="font-semibold text-brand-900">{t('leadershipDirectory.history_title')}</h2>
              <ul className="divide-y divide-slate-100">
                {history
                  .filter((r) => r.status !== 'PENDING')
                  .map((r) => (
                    <li key={r.id} className="py-2 text-sm">
                      <p className="font-medium text-slate-800">{r.label}</p>
                      <p className={r.status === 'APPROVED' ? 'text-green-700' : 'text-red-700'}>
                        {t(`leadershipDirectory.status_${r.status.toLowerCase()}`)}
                      </p>
                      {r.decisionNote && (
                        <p className="mt-0.5 text-xs italic text-slate-500">
                          {t('leadershipDirectory.decision_note_label')} {r.decisionNote}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="card space-y-2">
            <h2 className="font-semibold text-brand-900">{t('leadershipDirectory.directory_title')}</h2>
            {directory === null ? (
              <p className="text-sm text-slate-400">{t('people.loading')}</p>
            ) : directory.length === 0 ? (
              <p className="text-sm text-slate-500">{t('leadershipDirectory.directory_empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {directory.map((d) => (
                  <li key={d.personId}>
                    <Link to={`/member/people/${d.personId}`} className="flex items-center gap-3 py-2">
                      <Avatar name={d.name} photoUrl={d.photoUrl} size={44} />
                      <span>
                        <span className="block font-semibold text-slate-800">{d.name}</span>
                        <span className="block text-xs text-slate-500">{d.label}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
