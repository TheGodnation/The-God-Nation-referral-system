import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { whatsappChatUrl } from '../../lib/followUp';

export interface QueuePerson {
  personId: string;
  name: string;
  whatsapp: string | null;
  language: 'en' | 'fr';
}

/**
 * The WhatsApp queue: write the message once (in English and in French), then go through the people one by one. For
 * each, WhatsApp opens with the words ready in their own language; you press send there, come back and press "Done,
 * next". Nothing is sent by the app, so it is safe for the phone number (no bulk sending), and takes a few seconds a person.
 */
export function WhatsAppQueue({ people, base, onClose }: { people: QueuePerson[]; base: string; onClose: () => void }) {
  const { t } = useTranslation();
  const withNumber = useMemo(() => people.filter((p) => p.whatsapp), [people]);
  const [text, setText] = useState<{ en: string; fr: string }>({ en: '', fr: '' });
  const [record, setRecord] = useState(true);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [contacted, setContacted] = useState(0);
  const [skipped, setSkipped] = useState(0);

  const needs = { en: withNumber.some((p) => p.language === 'en'), fr: withNumber.some((p) => p.language === 'fr') };
  const ready = (!needs.en || text.en.trim() !== '') && (!needs.fr || text.fr.trim() !== '');
  const current = withNumber[index];
  const finished = started && index >= withNumber.length;

  const message = (p: QueuePerson) => `${text[p.language].trim()}\n\n— ${t('needsMe.queue_signature', { lng: p.language })}`;

  function next(didContact: boolean) {
    if (didContact) {
      setContacted((n) => n + 1);
      if (record && current) api.post(`${base}/contacted`, { personId: current.personId, wellbeing: 'GOOD', note: 'WhatsApp' }).catch(() => {});
    } else setSkipped((n) => n + 1);
    setIndex((i) => i + 1);
  }

  return (
    <section className="card space-y-3" data-testid="whatsapp-queue">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-brand-900">{t('needsMe.queue_title')}</h3>
          <p className="text-sm text-slate-600">{t('needsMe.queue_help')}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm underline" data-testid="queue-close">{t('needsMe.queue_close')}</button>
      </div>

      {withNumber.length < people.length && <p className="text-xs text-amber-800">{t('needsMe.queue_no_whatsapp', { count: people.length - withNumber.length })}</p>}
      {withNumber.length === 0 && <p className="text-sm text-slate-600">{t('needsMe.queue_nobody')}</p>}

      {withNumber.length > 0 && !started && (
        <div className="space-y-2">
          {needs.en && (
            <label className="block text-sm font-medium text-slate-700">
              {t('needsMe.queue_en_label', { count: withNumber.filter((p) => p.language === 'en').length })}
              <textarea value={text.en} onChange={(e) => setText({ ...text, en: e.target.value })} rows={3} maxLength={1500} className="input mt-1" data-testid="queue-text-en" />
            </label>
          )}
          {needs.fr && (
            <label className="block text-sm font-medium text-slate-700">
              {t('needsMe.queue_fr_label', { count: withNumber.filter((p) => p.language === 'fr').length })}
              <textarea value={text.fr} onChange={(e) => setText({ ...text, fr: e.target.value })} rows={3} maxLength={1500} className="input mt-1" data-testid="queue-text-fr" />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            {t('needsMe.queue_record')}
          </label>
          <button type="button" disabled={!ready} onClick={() => setStarted(true)} className="btn-primary disabled:opacity-50" data-testid="queue-start">
            {t('needsMe.queue_start', { count: withNumber.length })}
          </button>
        </div>
      )}

      {started && current && (
        <div className="space-y-3" data-testid="queue-current">
          <p className="text-sm text-slate-500" data-testid="queue-progress">{t('needsMe.queue_progress', { current: index + 1, total: withNumber.length })}</p>
          <p className="text-lg font-semibold text-slate-900">
            {current.name} <span className="text-sm font-medium text-slate-600">{current.language === 'fr' ? t('needsMe.lang_fr') : t('needsMe.lang_en')}</span>
          </p>
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message(current)}</p>
          <div className="flex flex-wrap gap-2">
            <a href={whatsappChatUrl(current.whatsapp!, message(current))} target="_blank" rel="noreferrer" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-green-700" data-testid="queue-open">
              {t('needsMe.queue_open')}
            </a>
            <button type="button" onClick={() => next(true)} className="btn-primary" data-testid="queue-next">{t('needsMe.queue_done_next')}</button>
            <button type="button" onClick={() => next(false)} className="btn-secondary" data-testid="queue-skip">{t('needsMe.queue_skip')}</button>
          </div>
        </div>
      )}

      {finished && <p className="rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800" role="status" data-testid="queue-finished">{t('needsMe.queue_finished', { done: contacted, skipped })}</p>}
    </section>
  );
}
