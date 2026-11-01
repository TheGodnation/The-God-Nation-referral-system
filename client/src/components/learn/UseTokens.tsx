import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

export interface SpendQuote {
  enabled: boolean;
  price: number;
  count: number;
  balance: number;
  perBookCap: number;
  maxTokens: number;
  maxFrancs: number;
  valueFcfa: number;
  maxPercent: number;
}

/** What the member could use toward `count` books. Null while loading, off, or when it fails. */
export function useSpendQuote(count: number): SpendQuote | null {
  const [quote, setQuote] = useState<SpendQuote | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<SpendQuote>(`/api/member/tokens/spend-quote?count=${count}`)
      .then((q) => alive && setQuote(q.enabled && q.maxTokens > 0 ? q : null))
      .catch(() => alive && setQuote(null));
    return () => {
      alive = false;
    };
  }, [count]);
  return quote;
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

// "Use my King's Tokens": appears only when spending has been switched on and
// the member has tokens to use. Tokens pay up to the limit; the rest is paid as usual.
export function UseTokensBox({ quote, checked, onChange }: { quote: SpendQuote | null; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  if (!quote) return null;
  const cash = quote.price * quote.count - quote.maxFrancs;
  return (
    <div className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="use-tokens">
      <label className="flex items-start gap-2 font-semibold">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>👑 {t('tokensUse.label', { tokens: quote.maxTokens.toLocaleString('fr-FR'), francs: fcfa(quote.maxFrancs) })}</span>
      </label>
      <p className="text-xs">{checked ? t('tokensUse.you_pay', { cash: fcfa(cash) }) : t('tokensUse.limit', { percent: quote.maxPercent })}</p>
    </div>
  );
}
