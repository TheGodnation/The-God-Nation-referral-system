import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { PersonCard, type PersonCardData } from '../components/people/PersonCard';
import { api } from '../lib/api';

function Section({ title, items, empty }: { title: string; items: PersonCardData[] | null; empty?: string }) {
  const { t } = useTranslation();
  if (items !== null && items.length === 0 && !empty) return null;
  return (
    <section className="card">
      <h2 className="mb-2 font-semibold text-brand-900">{title}</h2>
      {items === null ? (
        <p className="text-sm text-slate-400">{t('people.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((p) => (
            <PersonCard key={p.personId} person={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

// The member People page: friend requests, search, people near you,
// people you may know, and your friends.
export function MemberPeoplePage() {
  const { t } = useTranslation();
  const [incoming, setIncoming] = useState<PersonCardData[] | null>(null);
  const [near, setNear] = useState<PersonCardData[] | null>(null);
  const [suggested, setSuggested] = useState<PersonCardData[] | null>(null);
  const [friends, setFriends] = useState<PersonCardData[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonCardData[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<'EVERYONE' | 'SAME_GROUP' | null>(null);

  useEffect(() => {
    api.get<{ incoming: PersonCardData[] }>('/api/member/friends/requests').then((r) => setIncoming(r.incoming)).catch(() => setIncoming([]));
    api.get<{ items: PersonCardData[] }>('/api/member/people/near').then((r) => setNear(r.items)).catch(() => setNear([]));
    api.get<{ items: PersonCardData[] }>('/api/member/people/suggested').then((r) => setSuggested(r.items)).catch(() => setSuggested([]));
    api.get<{ items: PersonCardData[] }>('/api/member/friends').then((r) => setFriends(r.items)).catch(() => setFriends([]));
    api
      .get<{ friendRequestPolicy: 'EVERYONE' | 'SAME_GROUP' }>('/api/member/me/social-settings')
      .then((r) => setPolicy(r.friendRequestPolicy))
      .catch(() => {});
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    if (query.trim().length < 2) {
      setSearchError(t('people.search_too_short'));
      return;
    }
    try {
      const r = await api.get<{ items: PersonCardData[] }>(`/api/member/people?search=${encodeURIComponent(query.trim())}`);
      setResults(r.items);
    } catch {
      setSearchError(t('people.action_failed'));
    }
  }

  async function changePolicy(next: 'EVERYONE' | 'SAME_GROUP') {
    setPolicy(next);
    await api.patch('/api/member/me/social-settings', { friendRequestPolicy: next }).catch(() => {});
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('people.title')}</h1>
          <NotificationBell />
        </div>

        <div className="space-y-6">
          <Section title={t('people.requests')} items={incoming} />

          <section className="card">
            <form onSubmit={search} className="flex gap-2">
              <input
                className="input flex-1"
                aria-label={t('people.search_label') ?? ''}
                placeholder={t('people.search_placeholder') ?? ''}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className="btn-primary px-4">
                {t('people.search')}
              </button>
            </form>
            {searchError && <p className="mt-2 text-sm text-red-700">{searchError}</p>}
            {results && (
              <ul className="mt-2 divide-y divide-slate-100">
                {results.length === 0 && <li className="py-2 text-sm text-slate-500">{t('people.no_results')}</li>}
                {results.map((p) => (
                  <PersonCard key={p.personId} person={p} />
                ))}
              </ul>
            )}
          </section>

          <Section title={t('people.near_you')} items={near} empty={t('people.near_empty')} />
          <Section title={t('people.may_know')} items={suggested} />
          <Section title={t('people.my_friends')} items={friends} empty={t('people.no_friends')} />

          {policy && (
            <section className="card space-y-2">
              <h2 className="font-semibold text-brand-900">{t('people.settings_title')}</h2>
              <p className="text-sm text-slate-600">{t('people.policy_label')}</p>
              {(['EVERYONE', 'SAME_GROUP'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="friend-policy" checked={policy === p} onChange={() => changePolicy(p)} />
                  {p === 'EVERYONE' ? t('people.policy_everyone') : t('people.policy_same_group')}
                </label>
              ))}
            </section>
          )}
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
