import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';

export type SharedKind = 'post' | 'announcement' | 'update';

type PerLang = { en?: string | null; fr?: string | null };

// The post's own formatting marks (## headings, **bold**, - bullets) would show as raw symbols in WhatsApp: take them out.
const plain = (text: string) =>
  text
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The words that go to WhatsApp with the link: the title in bold, the first lines in bold (so they can be read at a glance), then
 * "Read more" and the link. WhatsApp draws the little preview card itself, and its writing cannot be styled; this text is ours.
 */
export function whatsappText({ title, teaser, link, readMore }: { title: string; teaser?: string | null; link: string; readMore: string }): string {
  const head = plain(title);
  let body = plain(teaser ?? '');
  // A post that starts with its own title: do not say it twice.
  if (head && body.toLowerCase().startsWith(head.toLowerCase())) body = body.slice(head.length).replace(/^[\s:.\-–—]+/, '');
  if (body.length > 220) {
    const cut = body.slice(0, 220);
    const space = cut.lastIndexOf(' ');
    body = `${(space > 150 ? cut.slice(0, space) : cut).trim()}…`;
  }
  return [head ? `📣 *${head}*` : '', body ? `*${body}*` : '', '', `👉 ${readMore}`, link].filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
}

/** Which API door to use: the admin dashboard, or the National Coordinator's own member profile. */
export const SHARE_BASE_ADMIN = '/api/admin/shared';
export const SHARE_BASE_MEMBER = '/api/member/central-shared';
export const shareBaseFor = (listBase: string | undefined) => (listBase && listBase.includes('/api/member/') ? SHARE_BASE_MEMBER : SHARE_BASE_ADMIN);

interface ShareState {
  shared: boolean;
  path: string;
}

// "Share by link": opens the public page of one published post or announcement, then offers WhatsApp (in English or French),
// copy, and "stop sharing". Visitors read the words without signing in and are invited to join.
export function ShareByLinkSheet({ kind, id, title, titles, teaser, base, onClose }: { kind: SharedKind; id: string; title: string; titles?: PerLang; teaser?: PerLang; base: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<ShareState | null>(null);
  // The words as visitors will read them, in each language (the saved translation of the post is used for French).
  const [refresh, setRefresh] = useState(0);
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
  const whatsapp = (lang: 'en' | 'fr') => {
    const text = whatsappText({
      title: words?.title[lang] || titles?.[lang] || title,
      teaser: words?.body[lang] || teaser?.[lang] || teaser?.en || teaser?.fr,
      link: `${link}?lang=${lang}`,
      readMore: i18n.t('shareLink.read_more', { lng: lang }),
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
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
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-primary" onClick={() => whatsapp('en')} data-testid="share-wa-en">
                {t('shareLink.wa_en')}
              </button>
              <button type="button" className="btn-primary" onClick={() => whatsapp('fr')} data-testid="share-wa-fr">
                {t('shareLink.wa_fr')}
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
