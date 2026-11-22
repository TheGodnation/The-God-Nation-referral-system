import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { api } from '../lib/api';
import { useStoreApp } from '../lib/storeApp';

interface Row {
  rank: number;
  name: string;
  total: number;
  isMe: boolean;
}
interface RankingData {
  count: number;
  items: Row[];
  me: Row | null;
}

const fmt = (n: number, lang: string) => n.toLocaleString(lang.startsWith('fr') ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 });
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Every member ranked by all the tokens earned by studying (exams and teaching quizzes): name and total only.
export function MemberTokenRankingPage() {
  const { t, i18n } = useTranslation();
  const store = useStoreApp();
  const [data, setData] = useState<RankingData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<RankingData>('/api/member/tokens/ranking')
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const amount = (n: number) => t(store ? 'tokenRanking.points' : 'tokenRanking.tokens', { count: n, amount: fmt(n, i18n.language) });

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{store ? '⭐' : '👑'} {t('tokenRanking.title')}</h1>
          <NotificationBell />
        </div>
        <p className="text-slate-700">{t(store ? 'tokenRanking.intro_store' : 'tokenRanking.intro')}</p>
        {failed && <p className="text-sm text-red-700">{t('tokenRanking.load_failed')}</p>}
        {!data && !failed && <p className="text-sm text-slate-400">{t('common.loading')}</p>}

        {data && (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900" role="status" data-testid="ranking-me">
              {data.me ? (
                <>
                  <strong>{t('tokenRanking.you', { rank: data.me.rank })}</strong> · {amount(data.me.total)}
                </>
              ) : (
                t(store ? 'tokenRanking.you_none_store' : 'tokenRanking.you_none')
              )}
            </p>

            {data.items.length === 0 ? (
              <p className="text-sm text-slate-600">{t(store ? 'tokenRanking.empty_store' : 'tokenRanking.empty')}</p>
            ) : (
              <section className="card p-0" data-testid="ranking-list">
                <p className="px-4 pt-3 text-xs text-slate-500">{t('tokenRanking.count', { count: data.count })}</p>
                <ol className="mt-1 divide-y divide-slate-100">
                  {data.items.map((r, i) => (
                    <li
                      key={`${r.rank}-${i}`}
                      className={`flex items-center gap-3 px-4 py-3 ${r.isMe ? 'bg-amber-50 font-semibold' : ''}`}
                      data-testid="ranking-row"
                      aria-current={r.isMe ? 'true' : undefined}
                    >
                      <span className="w-10 shrink-0 text-center text-lg text-brand-900" aria-label={`${t('tokenRanking.rank')} ${r.rank}`}>
                        {MEDAL[r.rank] ?? r.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-800">
                        {r.name}
                        {r.isMe && <span className="ml-2 rounded-full bg-brand-900 px-2 py-0.5 text-xs font-medium text-white">{t('tokenRanking.me_tag')}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-brand-900">{amount(r.total)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        <p>
          <Link to="/member/tokens" className="text-sm underline">{t(store ? 'tokenRanking.back_store' : 'tokenRanking.back')}</Link>
        </p>
      </section>
    </PageShell>
  );
}
