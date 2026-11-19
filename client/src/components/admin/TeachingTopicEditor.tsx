import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import type { TopicText } from '../teaching/teachingTypes';

type Kind = 'right' | 'key';
type Fields = Record<Exclude<keyof TopicText, 'verses'>, string> & { verses: string };

const FIELDS: { key: Exclude<keyof TopicText, 'verses'>; long?: boolean }[] = [
  { key: 'topic' },
  { key: 'bookTitle' },
  { key: 'chapter' },
  { key: 'teachingOn' },
  { key: 'help', long: true },
  { key: 'meaning', long: true },
  { key: 'startLabel' },
  { key: 'start', long: true },
  { key: 'ifNotLabel' },
  { key: 'ifNot', long: true },
  { key: 'dominion', long: true },
];

const blank = (): Fields => ({ topic: '', bookTitle: '', chapter: '', teachingOn: '', help: '', meaning: '', startLabel: '', start: '', ifNotLabel: '', ifNot: '', dominion: '', verses: '' });
const toFields = (t?: TopicText | null): Fields => (t ? { ...t, verses: t.verses.join(', ') } : blank());
const isEmpty = (f: Fields) => Object.values(f).every((v) => v.trim() === '');
const toText = (f: Fields): TopicText => ({ ...f, verses: f.verses.split(/[,;]/).map((v) => v.trim()).filter(Boolean) } as unknown as TopicText);

// Edit one teaching (or add a new one) in English and French. The wording is saved exactly as typed.
export function TeachingTopicEditor({ base, number, initial, onSaved, onCancel }: { base: string; number: number | null; initial: { kind: Kind; en: TopicText; fr: TopicText | null } | null; onSaved: (overview: unknown) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'key');
  const [lang, setLang] = useState<'en' | 'fr'>('en');
  const [en, setEn] = useState<Fields>(toFields(initial?.en));
  const [fr, setFr] = useState<Fields>(toFields(initial?.fr));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fields = lang === 'en' ? en : fr;
  const setFields = lang === 'en' ? setEn : setFr;
  const change = (key: keyof Fields, value: string) => setFields({ ...fields, [key]: value });

  async function save() {
    setError(null);
    if (isEmpty(en) || Object.entries(en).some(([k, v]) => k !== 'verses' && !v.trim())) return setError(t('teachingRota.fill_all_english'));
    const frEmpty = isEmpty(fr);
    if (!frEmpty && Object.entries(fr).some(([k, v]) => k !== 'verses' && !v.trim())) return setError(t('teachingRota.fill_all_french'));
    setBusy(true);
    try {
      const body = { kind, en: toText(en), fr: frEmpty ? null : toText(fr) };
      const r = number === null ? await api.post<{ overview: unknown }>(`${base}/topics`, body) : await api.put<{ overview: unknown }>(`${base}/topics/${number}`, body);
      onSaved(r.overview);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('teachingRota.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-3" data-testid="topic-editor">
      <h4 className="font-semibold text-brand-900">{number === null ? t('teachingRota.add_teaching') : t('teachingRota.edit_teaching')}</h4>
      <div className="flex flex-wrap items-center gap-2">
        {(['key', 'right'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === k ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
            {t(`teachingRota.kind_${k}`)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {(['en', 'fr'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${lang === l ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
            {l === 'en' ? '🇬🇧 English' : '🇫🇷 Français'}
          </button>
        ))}
      </div>
      {lang === 'fr' && <p className="text-xs text-slate-600">{t('teachingRota.french_optional')}</p>}
      {FIELDS.map(({ key, long }) => (
        <label key={key} className="block text-sm font-medium text-slate-700">
          {t(`teachingRota.f_${key}`)}
          {long ? <textarea className="input min-h-[5rem]" value={fields[key]} onChange={(e) => change(key, e.target.value)} /> : <input className="input" value={fields[key]} onChange={(e) => change(key, e.target.value)} />}
        </label>
      ))}
      <label className="block text-sm font-medium text-slate-700">
        {t('teachingRota.f_verses')}
        <input className="input" value={fields.verses} onChange={(e) => change('verses', e.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()} data-testid="topic-save">{t('teachingRota.save_topic')}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t('teachingRota.cancel')}</button>
      </div>
    </div>
  );
}
