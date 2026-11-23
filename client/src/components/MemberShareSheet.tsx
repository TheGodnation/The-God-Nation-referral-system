import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { composeShare, shareParts, type SharedKind } from './ShareByLinkSheet';

type PerLang = { en?: string | null; fr?: string | null };

// "Share with my link": any member shares a Headquarters post or one of the central admin's Updates on WhatsApp, Facebook or
// anywhere else. The link is the public page of the post with the member's own referral code, so anyone who joins from it is
// counted as that member's referral. Nothing to set up: the code is added by the app.
export function MemberShareSheet({ kind, id, title, titles, teaser, onClose }: { kind: Extract<SharedKind, 'post' | 'update'>; id: string; title: string; titles?: PerLang; teaser?: PerLang; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [info, setInfo] = useState<{ path: string; code: string } | null>(null);
  const [words, setWords] = useState<{ title: { en: string; fr: string }; body: { en: string; fr: string } } | null>(null);
  const [lang, setLang] = useState<'en' | 'fr'>(i18n.language.startsWith('fr') ? 'fr' : 'en');
  // A new version mark each time, so WhatsApp and Facebook read the post again instead of showing an old card.
  const [version] = useState(() => Date.now().toString(36));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .post<{ path: string; code: string }>(`/api/member/shared/${kind}/${id}/link`, {})
      .then((r) => alive && setInfo(r))
      .catch((err) => alive && setError(err instanceof ApiError && err.status === 409 ? t('shareLink.member_not_shareable') : t('shareLink.member_failed')));
    return () => {
      alive = false;
    };
  }, [kind, id, t]);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    api
      .get<{ title: { en: string; fr: string }; body: { en: string; fr: string } }>(`/api/shared/${kind}/${id}`)
      .then((r) => alive && r?.title && r?.body && setWords({ title: r.title, body: r.body }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [info, kind, id]);

  const link = info ? `${window.location.origin}${info.path}?ref=${encodeURIComponent(info.code)}&utm_source=member_share&utm_medium=social&lang=${lang}&v=${version}` : '';
  const message = (style: 'whatsapp' | 'plain') =>
    composeShare({
      title: words?.title[lang] || titles?.[lang] || title,
      teaser: words?.body[lang] || teaser?.[lang] || teaser?.en || teaser?.fr,
      link,
      readMore: i18n.t('shareLink.read_more', { lng: lang }),
      style,
    });
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(message('whatsapp'))}`, '_blank', 'noopener');
  const facebook = () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`, '_blank', 'noopener');
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message('plain'));
      setNote(t('shareLink.message_copied'));
    } catch {
      setNote(message('plain'));
    }
  };
  const otherApps = async () => {
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title: shareParts(words?.title[lang] || title, '').heading, text: message('plain') });
      else await copyMessage();
    } catch {
      // closed without sharing
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote(t('shareLink.copied'));
    } catch {
      setNote(link);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={t('shareLink.member_title') ?? ''} data-testid="member-share-sheet">
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-brand-900">{t('shareLink.member_title')}</h2>
            <p className="line-clamp-2 text-sm text-slate-600">{title}</p>
          </div>
          <button type="button" className="rounded-full px-2 text-2xl leading-none text-slate-500" aria-label={t('common.close') ?? ''} onClick={onClose}>
            ×
          </button>
        </div>
        {!info && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
        {info && (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{t('shareLink.member_explain')}</p>
            <div className="flex items-center justify-between gap-2" role="group" aria-label={t('shareLink.lang_label') ?? ''}>
              <span className="text-sm font-semibold text-slate-700">{t('shareLink.lang_label')}</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                {(['en', 'fr'] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`px-4 py-1.5 text-sm font-semibold ${lang === l ? 'bg-brand-700 text-white' : 'bg-white text-slate-700'}`} data-testid={`member-share-lang-${l}`}>
                    {l === 'en' ? 'English' : 'Français'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-primary" onClick={whatsapp} data-testid="member-share-wa">
                {t('shareLink.share_whatsapp')}
              </button>
              <button type="button" className="btn-primary" onClick={facebook} data-testid="member-share-fb">
                {t('shareLink.share_facebook')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void otherApps()} data-testid="member-share-other">
                {t('shareLink.share_other')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void copyMessage()} data-testid="member-share-copy-message">
                {t('shareLink.copy_message')}
              </button>
            </div>
            <button type="button" className="text-sm text-brand-700 underline" onClick={copyLink} data-testid="member-share-copy-link">
              {t('shareLink.copy')}
            </button>
          </>
        )}
        {note && <p className="break-all text-sm text-emerald-700">{note}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}

/** A small "Share" button that opens the sheet for one post. */
export function MemberShareButton({ kind, id, title, titles, teaser, className = '' }: { kind: Extract<SharedKind, 'post' | 'update'>; id: string; title: string; titles?: PerLang; teaser?: PerLang; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className || 'rounded-full px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-slate-100'} onClick={() => setOpen(true)} data-testid={`member-share-${kind}`}>
        🔗 {t('shareLink.member_button')}
      </button>
      {open && <MemberShareSheet kind={kind} id={id} title={title} titles={titles} teaser={teaser} onClose={() => setOpen(false)} />}
    </>
  );
}
