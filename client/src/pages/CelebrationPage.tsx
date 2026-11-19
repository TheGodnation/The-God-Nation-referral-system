import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api } from '../lib/api';
import { useDocumentMeta } from '../lib/useDocumentMeta';

interface Celebration {
  title: { en: string; fr: string };
  intro: { en: string; fr: string };
  message: { en: string; fr: string };
  names: string[];
}

const COLORS = ['#f2c94c', '#2a5cf0', '#80abff', '#ffffff', '#e0a800'];

// A small burst of confetti that falls once when the page opens (not for people who ask their phone for less motion).
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        id: i,
        left: Math.round((i * 97) % 100),
        delay: ((i * 37) % 20) / 10,
        duration: 3 + ((i * 53) % 25) / 10,
        color: COLORS[i % COLORS.length],
        wide: i % 3 === 0,
        spin: (i * 71) % 360,
      })),
    [],
  );
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-0 h-screen overflow-hidden" data-testid="confetti">
      <style>{`@keyframes godnation-fall{0%{transform:translateY(-12vh) rotate(0deg);opacity:1}85%{opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:0}}`}</style>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{ position: 'absolute', top: 0, left: `${p.left}%`, width: p.wide ? 14 : 8, height: p.wide ? 8 : 14, background: p.color, borderRadius: 2, rotate: `${p.spin}deg`, opacity: 0, animation: `godnation-fall ${p.duration}s ease-in ${p.delay}s 1 forwards` }}
        />
      ))}
    </div>
  );
}

// The public "Congratulations" page (https://thegodnationacademy.org/congratulations): the students who finished the books,
// with the central admin's own encouraging words. Anyone with the link can read it; it ends by inviting the reader to begin
// their own training. It shows nothing until the central admin switches it on.
export function CelebrationPage() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'fr' = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const [data, setData] = useState<Celebration | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'closed'>('loading');

  useEffect(() => {
    let alive = true;
    api
      .get<Celebration>('/api/celebration')
      .then((r) => {
        if (!alive) return;
        setData(r);
        setState('ready');
      })
      .catch(() => alive && setState('closed'));
    return () => {
      alive = false;
    };
  }, []);

  useDocumentMeta(data ? data.title[lang] : t('celebration.page_title_fallback'), data ? data.intro[lang] : '');

  return (
    <PageShell>
      <div className="relative overflow-hidden bg-gradient-to-b from-brand-900 via-brand-800 to-brand-700 text-white">
        {state === 'ready' && <Confetti />}
        <article className="relative z-10 mx-auto max-w-2xl px-4 py-10 text-center">
          {state === 'loading' && <p className="py-20 text-white/70">{t('common.loading')}</p>}
          {state === 'closed' && (
            <div className="py-16" data-testid="celebration-closed">
              <p className="text-5xl">🎓</p>
              <h1 className="mt-4 text-2xl font-bold">{t('celebration.closed_title')}</h1>
              <p className="mt-2 text-white/80">{t('celebration.closed_text')}</p>
            </div>
          )}
          {state === 'ready' && data && (
            <>
              <p className="text-6xl" aria-hidden>🎉</p>
              <h1 className="mt-3 text-3xl font-extrabold leading-tight text-gold-400 sm:text-4xl" data-testid="celebration-title">
                {data.title[lang]}
              </h1>
              {data.intro[lang] && <p className="mx-auto mt-3 max-w-xl text-lg text-white/90">{data.intro[lang]}</p>}
              {data.names.length > 0 && (
                <>
                  <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-gold-400">{t('celebration.count', { count: data.names.length })}</p>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="celebration-names">
                    {data.names.map((name) => (
                      <li key={name} className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-lg font-semibold shadow-sm backdrop-blur">
                        <span aria-hidden className="mr-2">🎓</span>
                        {name}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {data.message[lang] && (
                <div className="mx-auto mt-8 max-w-xl rounded-2xl bg-white p-5 text-left text-slate-800 shadow-lg" data-testid="celebration-message">
                  {data.message[lang].split(/\n\s*\n/).map((para, i) => (
                    <p key={i} className="mb-3 whitespace-pre-line leading-relaxed last:mb-0 last:font-semibold last:text-brand-900">
                      {para}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-8">
                <p className="mb-3 text-white/90">{t('celebration.cta_text')}</p>
                <Link to="/member/join" className="inline-block rounded-xl bg-gold-400 px-6 py-3 text-lg font-bold text-brand-900 no-underline shadow-lg" data-testid="celebration-cta">
                  {t('celebration.cta')}
                </Link>
              </div>
            </>
          )}
        </article>
      </div>
    </PageShell>
  );
}
