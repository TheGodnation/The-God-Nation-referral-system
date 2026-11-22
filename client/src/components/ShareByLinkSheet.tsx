import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';

export type SharedKind = 'post' | 'announcement' | 'update';

type PerLang = { en?: string | null; fr?: string | null };

// The post's own formatting marks (## headings, **bold**, - bullets) would show as raw symbols when shared: take them out.
const clean = (text: string) =>
  text
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*[-•]\s+/, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const plain = (text: string) => clean(text.split('\n').map(clean).filter(Boolean).join(' '));

/** A line that is a heading in the post: a "##" line, a whole line in **bold**, or a short line in capitals. */
function looksLikeHeading(raw: string, text: string): boolean {
  if (/^\s{0,3}#{1,6}\s/.test(raw) || /^\s*\*\*[^*]+\*\*\s*$/.test(raw)) return true;
  return text.length <= 100 && text === text.toUpperCase() && /[A-ZÀ-Ý]/.test(text);
}

/** The post as a heading, an optional sub-heading, and the first part of the writing. */
export function shareParts(title: string, body: string | null | undefined): { heading: string; sub: string; text: string } {
  const heading = clean(title);
  const lines = (body ?? '')
    .split('\n')
    .map((raw) => ({ raw, text: clean(raw) }))
    .filter((l) => l.text);
  // A post that starts with its own title: do not say it twice.
  if (lines.length && heading && lines[0].text.toLowerCase().startsWith(heading.toLowerCase())) {
    const rest = lines[0].text.slice(heading.length).replace(/^[\s:.\-–—]+/, '');
    if (rest) lines[0] = { raw: rest, text: rest };
    else lines.shift();
  }
  let sub = '';
  if (lines.length > 1 && looksLikeHeading(lines[0].raw, lines[0].text)) sub = lines.shift()!.text;
  let text = lines.map((l) => l.text).join(' ');
  if (text.length > 380) {
    const cut = text.slice(0, 380);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    const space = cut.lastIndexOf(' ');
    text = stop > 220 ? cut.slice(0, stop + 1) : `${(space > 280 ? cut.slice(0, space) : cut).trim()}…`;
  }
  return { heading, sub, text };
}

type ShareStyle = 'whatsapp' | 'plain';

/**
 * The same order everywhere: heading, sub-heading, the first part of the writing, then "Read more" and the link.
 * "whatsapp" uses WhatsApp's marks (*bold*, _italic_); "plain" has none, for Facebook, e-mail, SMS and the like.
 */
export function composeShare({ title, teaser, link, readMore, style = 'whatsapp' }: { title: string; teaser?: string | null; link: string; readMore: string; style?: ShareStyle }): string {
  const { heading, sub, text } = shareParts(title, teaser);
  const wa = style === 'whatsapp';
  const top = [heading ? (wa ? `📣 *${heading}*` : `📣 ${heading}`) : '', sub ? (wa ? `_${sub}_` : sub) : ''].filter(Boolean).join('\n');
  const end = [wa ? `👉 *${readMore}*` : `👉 ${readMore}`, link].join('\n');
  return [top, text, end].filter(Boolean).join('\n\n');
}

/** Kept for the WhatsApp message. */
export const whatsappText = (args: { title: string; teaser?: string | null; link: string; readMore: string }) => composeShare({ ...args, style: 'whatsapp' });

/** Which API door to use: the admin dashboard, or the National Coordinator's own member profile. */
export const SHARE_BASE_ADMIN = '/api/admin/shared';
export const SHARE_BASE_MEMBER = '/api/member/central-shared';
export const shareBaseFor = (listBase: string | undefined) => (listBase && listBase.includes('/api/member/') ? SHARE_BASE_MEMBER : SHARE_BASE_ADMIN);

interface ShareState {
  shared: boolean;
  path: string;
}

interface WebsiteState {
  published: boolean;
  articleId?: string;
  divisionKey?: string;
  paths?: { en?: string; fr?: string };
  frenchReviewed?: boolean;
  hasFrench?: boolean;
  divisions: { key: string; name: { en: string; fr: string } }[];
}

// "Also publish on the website": the post becomes a public article (English and French) that Google can list, with the invitation
// to join. It goes out at once; the French (made automatically) can be read and corrected later in the Knowledge Centre.
function WebsiteSection({ base, kind, id, onPublished }: { base: string; kind: SharedKind; id: string; onPublished: () => void }) {
  const { t, i18n } = useTranslation();
  const [site, setSite] = useState<WebsiteState | null>(null);
  const [area, setArea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fr = i18n.language.startsWith('fr');
  useEffect(() => {
    let alive = true;
    api
      .get<WebsiteState>(`${base}/${kind}/${id}/website`)
      .then((r) => {
        if (!alive || !r || !Array.isArray(r.divisions)) return;
        setSite(r);
        setArea(r.divisionKey ?? '');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [base, kind, id]);
  if (!site) return null;
  async function run(fn: () => Promise<WebsiteState>, shared = false) {
    setBusy(true);
    setError('');
    try {
      setSite(await fn());
      if (shared) onPublished();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('shareLink.failed'));
    } finally {
      setBusy(false);
    }
  }
  const publish = () => run(() => api.post<WebsiteState>(`${base}/${kind}/${id}/website`, { divisionKey: area }), true);
  const origin = window.location.origin;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid="website-section">
      <p className="text-sm font-semibold text-brand-900">🌐 {t('shareLink.web_title')}</p>
      {!site.published && (
        <>
          <p className="text-xs text-slate-600">{t('shareLink.web_explain')}</p>
          <label className="block text-xs font-semibold text-slate-700" htmlFor={`web-area-${id}`}>{t('shareLink.web_area')}</label>
          <select id={`web-area-${id}`} className="input w-full" value={area} onChange={(e) => setArea(e.target.value)} data-testid="website-area">
            <option value="">{t('shareLink.web_choose')}</option>
            {site.divisions.map((d) => (
              <option key={d.key} value={d.key}>{fr ? d.name.fr : d.name.en}</option>
            ))}
          </select>
          <button type="button" className="btn-primary w-full" disabled={busy || !area} onClick={() => void publish()} data-testid="website-publish">
            {busy ? t('shareLink.web_publishing') : t('shareLink.web_publish')}
          </button>
        </>
      )}
      {site.published && (
        <>
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="website-live">✓ {t('shareLink.web_live')}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {site.paths?.en && <a className="text-brand-700 underline" href={`${origin}${site.paths.en}`} target="_blank" rel="noreferrer">{t('shareLink.web_see_en')}</a>}
            {site.paths?.fr && <a className="text-brand-700 underline" href={`${origin}${site.paths.fr}`} target="_blank" rel="noreferrer">{t('shareLink.web_see_fr')}</a>}
          </div>
          <p className="text-xs text-slate-600" data-testid="website-french">
            {!site.hasFrench ? t('shareLink.web_no_french') : site.frenchReviewed ? t('shareLink.web_french_read') : t('shareLink.web_french_auto')}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="text-brand-700 underline disabled:text-slate-300" disabled={busy} onClick={() => void publish()} data-testid="website-update">{t('shareLink.web_update')}</button>
            <button type="button" className="ml-auto text-red-700 underline disabled:text-slate-300" disabled={busy} onClick={() => void run(() => api.delete<WebsiteState>(`${base}/${kind}/${id}/website`))} data-testid="website-off">{t('shareLink.web_off')}</button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

// "Share by link": opens the public page of one published post or announcement, then offers WhatsApp (in English or French),
// copy, and "stop sharing". Visitors read the words without signing in and are invited to join.
export function ShareByLinkSheet({ kind, id, title, titles, teaser, base, onClose }: { kind: SharedKind; id: string; title: string; titles?: PerLang; teaser?: PerLang; base: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<ShareState | null>(null);
  // The words as visitors will read them, in each language (the saved translation of the post is used for French).
  const [refresh, setRefresh] = useState(0);
  // The language of the message and of the page the link opens.
  const [lang, setLang] = useState<'en' | 'fr'>(i18n.language.startsWith('fr') ? 'fr' : 'en');
  // Every time the sheet is opened the link gets a new version mark, so WhatsApp and Facebook read the post again
  // (with the same link they keep showing the card they saved earlier, without its picture).
  const [version] = useState(() => Date.now().toString(36));
  const [words, setWords] = useState<{ title: { en: string; fr: string }; body: { en: string; fr: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .get<ShareState>(`${base}/${kind}/${id}`)
      .then((r) => alive && setState(r))
      .catch(() => alive && setError(t('shareLink.load_failed')));
    return () => {
      alive = false;
    };
  }, [base, kind, id, t]);

  const link = state ? `${window.location.origin}${state.path}` : '';

  useEffect(() => {
    if (!state?.shared) return;
    let alive = true;
    api
      .get<{ title: { en: string; fr: string }; body: { en: string; fr: string } }>(`/api/shared/${kind}/${id}`)
      .then((r) => alive && r?.title && r?.body && setWords({ title: r.title, body: r.body }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state?.shared, kind, id, refresh]);
  // No saved French for this post: the French message would be in English, and the sheet says so.
  const noFrench = Boolean(words && plain(words.body.fr) === plain(words.body.en));

  async function change(open: boolean) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const r = open ? await api.post<ShareState>(`${base}/${kind}/${id}/share`, {}) : await api.delete<ShareState>(`${base}/${kind}/${id}/share`);
      setState(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('shareLink.failed'));
    } finally {
      setBusy(false);
    }
  }
  // Asks the server to make the French now (it translates a post that has none), then reads the words again.
  async function makeFrench() {
    await change(true);
    setRefresh((n) => n + 1);
  }
  const message = (style: ShareStyle) =>
    composeShare({
      title: words?.title[lang] || titles?.[lang] || title,
      teaser: words?.body[lang] || teaser?.[lang] || teaser?.en || teaser?.fr,
      link: `${link}?lang=${lang}&v=${version}`,
      readMore: i18n.t('shareLink.read_more', { lng: lang }),
      style,
    });
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(message('whatsapp'))}`, '_blank', 'noopener');
  // Facebook builds its own card from the link (title, picture and first lines), so it only needs the link.
  const facebook = () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${link}?lang=${lang}&v=${version}`)}`, '_blank', 'noopener');
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message('plain'));
      setNote(t('shareLink.message_copied'));
    } catch {
      setNote(message('plain'));
    }
  };
  // The phone's own share list (Telegram, Messenger, SMS, e-mail...): the plain message, in the same order.
  const otherApps = async () => {
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title: shareParts(words?.title[lang] || title, '').heading, text: message('plain') });
      else await copyMessage();
    } catch {
      // closed without sharing
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote(t('shareLink.copied'));
    } catch {
      setNote(link);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={t('shareLink.title') ?? ''} data-testid="share-sheet">
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-brand-900">{t('shareLink.title')}</h2>
            <p className="line-clamp-2 text-sm text-slate-600">{title}</p>
          </div>
          <button type="button" className="rounded-full px-2 text-2xl leading-none text-slate-500" aria-label={t('common.close') ?? ''} onClick={onClose}>
            ×
          </button>
        </div>
        {!state && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
        {state && !state.shared && (
          <>
            <p className="text-sm text-slate-700">{t('shareLink.explain')}</p>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => change(true)} data-testid="share-open">
              {t('shareLink.open')}
            </button>
          </>
        )}
        {state?.shared && (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{t('shareLink.is_open')}</p>
            <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="share-link">{link}</p>
            {noFrench && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="share-no-french">
                {t('shareLink.no_french')}{' '}
                <button type="button" className="font-semibold underline disabled:text-slate-400" disabled={busy} onClick={() => void makeFrench()} data-testid="share-make-french">
                  {t('shareLink.make_french')}
                </button>
              </p>
            )}
            <div className="flex items-center justify-between gap-2" role="group" aria-label={t('shareLink.lang_label') ?? ''}>
              <span className="text-sm font-semibold text-slate-700">{t('shareLink.lang_label')}</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                {(['en', 'fr'] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`px-4 py-1.5 text-sm font-semibold ${lang === l ? 'bg-brand-700 text-white' : 'bg-white text-slate-700'}`} data-testid={`share-lang-${l}`}>
                    {l === 'en' ? 'English' : 'Français'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-primary" onClick={whatsapp} data-testid="share-wa">
                {t('shareLink.share_whatsapp')}
              </button>
              <button type="button" className="btn-primary" onClick={facebook} data-testid="share-fb">
                {t('shareLink.share_facebook')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void otherApps()} data-testid="share-other">
                {t('shareLink.share_other')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void copyMessage()} data-testid="share-copy-message">
                {t('shareLink.copy_message')}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" className="text-brand-700 underline" onClick={copy}>
                {t('shareLink.copy')}
              </button>
              <a className="text-brand-700 underline" href={state.path} target="_blank" rel="noreferrer">
                {t('shareLink.see')}
              </a>
              <button type="button" className="ml-auto text-red-700 underline disabled:text-slate-300" disabled={busy} onClick={() => change(false)} data-testid="share-stop">
                {t('shareLink.stop')}
              </button>
            </div>
          </>
        )}
        {state && <WebsiteSection base={base} kind={kind} id={id} onPublished={() => {
          setRefresh((n) => n + 1);
          api.get<ShareState>(`${base}/${kind}/${id}`).then(setState).catch(() => {});
        }} />}
        {note && <p className="text-sm text-emerald-700">{note}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}

/** A small button for the admin tables: opens the sheet for one published item. */
export function ShareByLinkButton({ kind, id, title, titles, teaser, base, className = '' }: { kind: SharedKind; id: string; title: string; titles?: PerLang; teaser?: PerLang; base: string; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className || 'text-brand-700 hover:underline'} onClick={() => setOpen(true)} data-testid={`share-btn-${id}`}>
        🔗 {t('shareLink.button')}
      </button>
      {open && <ShareByLinkSheet kind={kind} id={id} title={title} titles={titles} teaser={teaser} base={base} onClose={() => setOpen(false)} />}
    </>
  );
}
