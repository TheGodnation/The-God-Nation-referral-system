import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Data {
  saved: boolean;
  published: boolean;
  titleEn: string;
  titleFr: string;
  introEn: string;
  introFr: string;
  messageEn: string;
  messageFr: string;
  names: string[];
}

// "Congratulations page" for the central admin: the words (English and French), the names, and the switch. The link to share
// in WhatsApp is shown here. The same panel is used in the admin dashboard and in the National Coordinator's own profile.
export function CelebrationPanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Data | null>(null);
  const [namesText, setNamesText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = `${origin}/congratulations`;

  useEffect(() => {
    api
      .get<Data>(base)
      .then((d) => {
        setData(d);
        setNamesText(d.names.join('\n'));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('celebration.load_failed')));
  }, [base, t]);

  if (!data) return <p className="text-slate-500">{error ?? t('common.loading')}</p>;
  const set = (patch: Partial<Data>) => setData({ ...data, ...patch });
  const names = namesText.split('\n').map((n) => n.trim()).filter(Boolean);

  async function save(published = data!.published) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body = { published, titleEn: data!.titleEn, titleFr: data!.titleFr, introEn: data!.introEn, introFr: data!.introFr, messageEn: data!.messageEn, messageFr: data!.messageFr, names };
      const saved = await api.put<Data>(base, body);
      setData(saved);
      setNamesText(saved.names.join('\n'));
      setNote(t(published ? 'celebration.saved_open' : 'celebration.saved'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('celebration.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function useTeachingNames() {
    try {
      const r = await api.get<{ names: string[] }>(`${base}/teaching-names`);
      if (r.names.length === 0) return setNote(t('celebration.no_teaching_names'));
      setNamesText(r.names.join('\n'));
      setNote(t('celebration.names_filled', { count: r.names.length }));
    } catch {
      setError(t('celebration.load_failed'));
    }
  }

  const share = (lang: 'en' | 'fr') => {
    const text = lang === 'fr' ? `🎉 ${data.titleFr}\n${data.introFr}\n` : `🎉 ${data.titleEn}\n${data.introEn}\n`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}${link}?lang=${lang}`)}`, '_blank', 'noopener');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote(t('celebration.copied'));
    } catch {
      setNote(link);
    }
  };

  const field = 'input';
  return (
    <section className="space-y-4" data-testid="celebration-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('celebration.admin_title')}</h2>
        <p className="text-sm text-slate-600">{t('celebration.admin_help')}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{note}</p>}

      <div className="card space-y-2 !p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-slate-900">{data.published ? t('celebration.is_open') : t('celebration.is_closed')}</p>
          <button type="button" disabled={busy} className={data.published ? 'btn-secondary' : 'btn-primary'} data-testid="celebration-switch" onClick={() => void save(!data.published)}>
            {data.published ? t('celebration.close') : t('celebration.open')}
          </button>
        </div>
        <p className="break-all text-sm text-slate-700">{link}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={() => void copy()}>{t('celebration.copy_link')}</button>
          <a href="/congratulations" target="_blank" rel="noreferrer" className="btn-secondary text-center no-underline">{t('celebration.see_page')}</a>
          <button type="button" className="btn-secondary" disabled={!data.published} onClick={() => share('en')} data-testid="share-en">🇬🇧 {t('celebration.share_whatsapp')}</button>
          <button type="button" className="btn-secondary" disabled={!data.published} onClick={() => share('fr')} data-testid="share-fr">🇫🇷 {t('celebration.share_whatsapp')}</button>
        </div>
        {!data.published && <p className="text-xs text-slate-500">{t('celebration.closed_note')}</p>}
      </div>

      <div className="card space-y-2 !p-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('celebration.names')}</h3>
        <p className="text-xs text-slate-500">{t('celebration.names_help')}</p>
        <textarea className={`${field} min-h-[10rem]`} aria-label={t('celebration.names') ?? ''} value={namesText} onChange={(e) => setNamesText(e.target.value)} />
        <p className="text-xs text-slate-500">{t('celebration.names_count', { count: names.length })}</p>
        <button type="button" className="btn-secondary w-full" onClick={() => void useTeachingNames()}>{t('celebration.use_teaching_names')}</button>
      </div>

      {(['En', 'Fr'] as const).map((L) => (
        <div key={L} className="card space-y-2 !p-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{L === 'En' ? '🇬🇧 English' : '🇫🇷 Français'}</h3>
          <label className="block text-sm font-medium text-slate-700">
            {t('celebration.f_title')}
            <input className={field} value={data[`title${L}` as 'titleEn']} onChange={(e) => set({ [`title${L}`]: e.target.value } as Partial<Data>)} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {t('celebration.f_intro')}
            <textarea className={`${field} min-h-[4rem]`} value={data[`intro${L}` as 'introEn']} onChange={(e) => set({ [`intro${L}`]: e.target.value } as Partial<Data>)} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {t('celebration.f_message')}
            <textarea className={`${field} min-h-[14rem]`} value={data[`message${L}` as 'messageEn']} onChange={(e) => set({ [`message${L}`]: e.target.value } as Partial<Data>)} />
          </label>
        </div>
      ))}

      <button type="button" className="btn-primary w-full" disabled={busy} data-testid="celebration-save" onClick={() => void save()}>
        {t('celebration.save')}
      </button>
    </section>
  );
}
