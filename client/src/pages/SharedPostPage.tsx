import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { RichText } from '../lib/richText';
import { SocialEmbed, type SocialEmbedInfo } from '../components/updates/SocialEmbed';
import { api } from '../lib/api';
import { useDocumentMeta } from '../lib/useDocumentMeta';

interface Bi {
  en: string;
  fr: string;
}
interface SharedItem {
  kind: 'post' | 'announcement';
  id: string;
  title: Bi;
  body: Bi;
  author: string;
  publishedAt: string | null;
  mediaCount: number;
  embed: SocialEmbedInfo | null;
  more: { kind: 'post' | 'announcement'; id: string; title: Bi }[];
}

// A post or announcement the central admin shared by link (https://thegodnationacademy.org/news/post/<id>). Anyone can read
// the words without signing in; photos, comments and the rest stay inside the app, and the page invites the reader to join.
export function SharedPostPage() {
  const { t, i18n } = useTranslation();
  const { kind, id } = useParams();
  const lang: 'en' | 'fr' = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const [item, setItem] = useState<SharedItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'closed'>('loading');

  useEffect(() => {
    let alive = true;
    setState('loading');
    api
      .get<SharedItem>(`/api/shared/${kind}/${id}`)
      .then((r) => {
        if (!alive) return;
        setItem(r);
        setState('ready');
      })
      .catch(() => alive && setState('closed'));
    return () => {
      alive = false;
    };
  }, [kind, id]);

  useDocumentMeta(item ? item.title[lang] : t('shareLink.page_fallback'), item ? item.body[lang].slice(0, 160) : '');

  return (
    <PageShell>
      <div className="bg-slate-50">
        <article className="mx-auto max-w-2xl px-4 py-8">
          {state === 'loading' && <p className="py-20 text-center text-slate-500">{t('common.loading')}</p>}
          {state === 'closed' && (
            <div className="py-16 text-center" data-testid="shared-closed">
              <p className="text-5xl">📭</p>
              <h1 className="mt-4 text-2xl font-bold text-brand-900">{t('shareLink.closed_title')}</h1>
              <p className="mt-2 text-slate-600">{t('shareLink.closed_text')}</p>
              <Link to="/member/join" className="btn-primary mt-6 inline-block no-underline">{t('shareLink.cta')}</Link>
            </div>
          )}
          {state === 'ready' && item && (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
                {item.kind === 'announcement' ? t('shareLink.kind_announcement') : t('shareLink.kind_post')}
              </p>
              <h1 className="mt-1 text-3xl font-extrabold leading-tight text-brand-900" data-testid="shared-title">{item.title[lang]}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {item.author}
                {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString(lang)}` : ''}
              </p>
              <RichText text={item.body[lang]} className="mt-5 text-base leading-relaxed text-slate-800" data-testid="shared-body" />
              {item.embed && (
                <div className="mt-5">
                  <SocialEmbed embed={item.embed} />
                </div>
              )}
              {item.mediaCount > 0 && (
                <p className="mt-5 rounded-xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm" data-testid="shared-media-note">
                  📷 {t('shareLink.media_note', { count: item.mediaCount })}
                </p>
              )}

              <section className="mt-8 rounded-2xl bg-gradient-to-b from-brand-800 to-brand-900 p-6 text-center text-white shadow-lg" data-testid="shared-join">
                <h2 className="text-xl font-bold text-gold-400">{t('shareLink.join_title')}</h2>
                <p className="mt-2 text-white/90">{t('shareLink.join_text')}</p>
                <Link to="/member/join" className="mt-4 inline-block rounded-xl bg-gold-400 px-6 py-3 text-lg font-bold text-brand-900 no-underline shadow" data-testid="shared-cta">
                  {t('shareLink.cta')}
                </Link>
                <p className="mt-3 text-sm text-white/70">
                  {t('shareLink.have_account')} <Link to="/member/login" className="text-gold-400 underline">{t('shareLink.sign_in')}</Link>
                </p>
              </section>

              {item.more.length > 0 && (
                <section className="mt-8" data-testid="shared-more">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-500">{t('shareLink.more')}</h2>
                  <ul className="space-y-2">
                    {item.more.map((m) => (
                      <li key={`${m.kind}-${m.id}`}>
                        <Link to={`/news/${m.kind}/${m.id}`} className="block rounded-xl bg-white px-4 py-3 font-semibold text-brand-900 no-underline shadow-sm">
                          {m.title[lang]}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </article>
      </div>
    </PageShell>
  );
}
