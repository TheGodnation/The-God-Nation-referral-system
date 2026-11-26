import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { RichText } from '../lib/richText';
import { SocialEmbed, type SocialEmbedInfo } from '../components/updates/SocialEmbed';
import { api } from '../lib/api';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { previewOf, rememberPostToReturnTo } from '../lib/sharedPreview';

interface Bi {
  en: string;
  fr: string;
}
interface SharedItem {
  kind: 'post' | 'announcement' | 'update';
  id: string;
  title: Bi;
  body: Bi;
  author: string;
  publishedAt: string | null;
  mediaCount: number;
  embed: SocialEmbedInfo | null;
  photos?: { url: string }[];
  more: { kind: 'post' | 'announcement' | 'update'; id: string; title: Bi }[];
}

// A post or announcement shared by link (https://thegodnationacademy.org/news/post/<id>). A member reads all of it here, and at the
// end is invited into the Headquarters assembly, where everyone is, for the latest news. A visitor who is not a member reads the
// first half (never fewer than two paragraphs), then is invited to join to read the rest; after joining or signing in they are
// brought back to it. Inside Facebook's (or Instagram's) own browser on Android, which never knows that someone is signed in, a
// member can open the page in Chrome, where they are.
export function SharedPostPage() {
  const { t, i18n } = useTranslation();
  const { kind, id } = useParams();
  const { member, loading: authLoading } = useMemberAuth();
  const { pathname } = useLocation();
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

  // Where a member is sent at the end: the Headquarters assembly (generation 0), or Chats when it cannot be found.
  const [hqPath, setHqPath] = useState('/member/chats');
  useEffect(() => {
    if (!member) return;
    let alive = true;
    api
      .get<{ items: { communityId: string; generation?: number | null; status?: string }[] }>('/api/member/me/community-memberships')
      .then((r) => {
        const hq = r?.items?.find((m) => m.generation === 0);
        if (alive && hq) setHqPath(`/member/chats/group/${hq.communityId}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [member]);
  const chromeLink = openInChromeLink();

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
              {item.photos && item.photos.length > 0 && (
                <div className="mt-4 space-y-3" data-testid="shared-photos">
                  {item.photos.map((ph) => (
                    <img key={ph.url} src={ph.url} alt="" loading="lazy" className="w-full rounded-xl bg-slate-200 object-cover shadow-sm" />
                  ))}
                </div>
              )}
              {(() => {
                // Members (and anyone while it is still being checked whether they are signed in) read it all.
                const preview = member || authLoading ? { shown: item.body[lang], cut: false } : previewOf(item.body[lang]);
                if (!preview.cut) return <RichText text={item.body[lang]} headings comfort className="mt-5 text-base leading-relaxed text-slate-800" data-testid="shared-body" />;
                return (
                  <>
                    <div className="relative">
                      <RichText text={preview.shown} headings comfort className="mt-5 text-base leading-relaxed text-slate-800" data-testid="shared-body" />
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-slate-50/0 to-slate-50" />
                    </div>
                    <section className="mt-4 rounded-2xl border-2 border-gold-400 bg-white p-6 text-center shadow-lg" data-testid="shared-continue">
                      <p className="text-3xl" aria-hidden>📖</p>
                      <h2 className="mt-2 text-xl font-bold text-brand-900">{t('shareLink.continue_title')}</h2>
                      <p className="mt-2 text-slate-700">{t('shareLink.continue_text')}</p>
                      <Link to="/member/join" onClick={() => rememberPostToReturnTo(pathname)} className="mt-4 inline-block rounded-xl bg-brand-700 px-6 py-3 text-lg font-bold text-white no-underline shadow" data-testid="shared-continue-join">
                        {t('shareLink.continue_join')}
                      </Link>
                      <p className="mt-4 text-sm text-slate-600">
                        {t('shareLink.have_account')}{' '}
                        <Link to="/member/login" onClick={() => rememberPostToReturnTo(pathname)} className="font-semibold text-brand-700 underline" data-testid="shared-continue-signin">
                          {t('shareLink.continue_signin')}
                        </Link>
                      </p>
                      {chromeLink && (
                        <div className="mt-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-900" data-testid="shared-open-chrome">
                          <p>{t('shareLink.in_app_browser')}</p>
                          <a href={chromeLink} className="mt-2 inline-block rounded-lg border-2 border-brand-700 px-4 py-2 font-semibold text-brand-800 no-underline">
                            {t('shareLink.open_in_chrome')}
                          </a>
                        </div>
                      )}
                    </section>
                  </>
                );
              })()}
              {item.embed && (member || authLoading || !previewOf(item.body[lang]).cut) && (
                <div className="mt-5">
                  <SocialEmbed embed={item.embed} />
                </div>
              )}
              {item.mediaCount > 0 && !(item.photos && item.photos.length > 0) && (
                <p className="mt-5 rounded-xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm" data-testid="shared-media-note">
                  📷 {t('shareLink.media_note', { count: item.mediaCount })}
                </p>
              )}

              <section className="mt-8 rounded-2xl bg-gradient-to-b from-brand-800 to-brand-900 p-6 text-center text-white shadow-lg" data-testid="shared-join">
                {member ? (
                  <>
                    <h2 className="text-xl font-bold text-gold-400">{t('shareLink.hq_title')}</h2>
                    <p className="mt-2 text-white/90">{t('shareLink.hq_text')}</p>
                    <Link to={hqPath} className="mt-4 inline-block rounded-xl bg-gold-400 px-6 py-3 text-lg font-bold text-brand-900 no-underline shadow" data-testid="shared-enter">
                      🏛️ {t('shareLink.hq_button')}
                    </Link>
                  </>
                ) : (
                  <>
                    {/* The invitation to join, in the founder's words. */}
                    <p className="text-sm font-bold uppercase tracking-widest text-white/80">{t('shareLink.pitch_kicker')}</p>
                    <h2 className="mt-2 text-2xl font-extrabold uppercase leading-tight text-gold-400" data-testid="shared-pitch-title">{t('shareLink.pitch_title')}</h2>
                    <div className="mx-auto mt-4 max-w-prose space-y-3 text-left text-[15px] leading-relaxed text-white/90">
                      <p>{t('shareLink.pitch_p1')}</p>
                      <p>{t('shareLink.pitch_p2')}</p>
                    </div>
                    <ul className="mx-auto mt-5 grid max-w-md grid-cols-1 gap-2 text-left sm:grid-cols-2" data-testid="shared-pitch-points">
                      {(['p_grow', 'p_develop', 'p_influence', 'p_disciples', 'p_reach', 'p_represent'] as const).map((k) => (
                        <li key={k} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white">
                          <span aria-hidden className="text-gold-400">✓</span>
                          {t(`shareLink.${k}`)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-5 text-base font-extrabold uppercase tracking-wide text-gold-400">{t('shareLink.pitch_close')}</p>
                    <p className="mx-auto mt-1 max-w-prose text-[15px] font-semibold text-white">{t('shareLink.pitch_together')}</p>
                    <Link to="/member/join" onClick={() => rememberPostToReturnTo(pathname)} className="mt-4 inline-block rounded-xl bg-gold-400 px-6 py-3 text-lg font-bold text-brand-900 no-underline shadow" data-testid="shared-cta">
                      {t('shareLink.cta')}
                    </Link>
                    <p className="mt-5 text-sm text-white/80">{t('shareLink.have_account')}</p>
                    <Link to="/member/login" onClick={() => rememberPostToReturnTo(pathname)} className="mt-2 inline-block rounded-xl border-2 border-white/70 px-6 py-3 font-bold text-white no-underline" data-testid="shared-signin">
                      {t('shareLink.sign_in_enter')}
                    </Link>
                  </>
                )}
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

/**
 * Inside Facebook's, Messenger's or Instagram's own browser on an Android phone, a link that opens this same page in Chrome (where
 * a member is signed in). Elsewhere: null.
 */
export function openInChromeLink(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, href: string = typeof window === 'undefined' ? '' : window.location.href): string | null {
  if (!/Android/i.test(ua) || !/FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger/i.test(ua)) return null;
  try {
    const url = new URL(href);
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
  } catch {
    return null;
  }
}
