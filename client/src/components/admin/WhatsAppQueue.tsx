import { useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useTranslation } from 'react-i18next';
import { whatsappChatUrl } from '../../lib/followUp';

export interface QueuePerson {
  personId: string;
  name: string;
  whatsapp: string | null;
  language: 'en' | 'fr';
  /** What they agreed to: AGREED (ticked the box), NONE (never ticked), OPTED_OUT (asked us to stop). Missing counts as NONE. */
  consent?: 'AGREED' | 'NONE' | 'OPTED_OUT';
}

/** The two kinds of message. Help (a welcome, help signing in or finishing setup, a reply) may go to anyone who has not asked us to stop; a nudge ("we miss you", a reminder) only to people who agreed. */
export type QueueKind = 'help' | 'nudge';

const TEMPLATES: Record<QueueKind, { en: string; fr: string }> = {
  help: {
    en: 'Hello {name}, welcome to The God Nation! 🙏 We are so glad you are here. Open the app to take a look around, and if you need any help signing in or finishing your details, just reply here. God bless you!',
    fr: 'Bonjour {name}, bienvenue à The God Nation ! 🙏 Nous sommes si heureux que vous soyez là. Ouvrez l’application pour faire le tour, et si vous avez besoin d’aide pour vous connecter ou terminer vos informations, répondez simplement ici. Que Dieu vous bénisse !',
  },
  nudge: {
    en: 'Hello {name}, we have not seen you for a while and we miss you. 🙏 The teachings and prayers continue in the app. Reply here if I can help you in any way. God bless you!',
    fr: 'Bonjour {name}, nous ne vous avons pas vu depuis un moment et vous nous manquez. 🙏 Les enseignements et les prières continuent dans l’application. Répondez ici si je peux vous aider en quoi que ce soit. Que Dieu vous bénisse !',
  },
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The WhatsApp queue: write the message once (in English and in French), then go through the people one by one. For
 * each, WhatsApp opens with the words ready in their own language; you press send there, come back and press "Done,
 * next". Nothing is sent by the app, so it is safe for the phone number (no bulk sending), and takes a few seconds a person.
 */
export function WhatsAppQueue({ people, onClose, recordContact, signatureKey = 'needsMe.queue_signature', translateUrl, onStop, defaultKind = 'nudge' }: { people: QueuePerson[]; onClose: () => void; recordContact: (p: QueuePerson) => Promise<unknown> | void; signatureKey?: string; translateUrl?: string; onStop?: (p: QueuePerson) => Promise<unknown> | void; defaultKind?: QueueKind }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<QueueKind>(defaultKind);
  const [includeNoTick, setIncludeNoTick] = useState(false);
  // People who asked us to stop, here and now (so they drop out of the list at once).
  const [stopped, setStopped] = useState<Set<string>>(new Set());
  const consentOf = (p: QueuePerson) => (stopped.has(p.personId) ? 'OPTED_OUT' : p.consent ?? 'NONE');
  const withNumber = useMemo(
    () =>
      people.filter((p) => {
        if (!p.whatsapp) return false;
        const c = stopped.has(p.personId) ? 'OPTED_OUT' : p.consent ?? 'NONE';
        if (c === 'OPTED_OUT') return false; // never, whatever the message
        if (kind === 'help') return true;
        return c === 'AGREED' || includeNoTick;
      }),
    [people, kind, includeNoTick, stopped],
  );
  const optedOutCount = people.filter((p) => p.whatsapp && consentOf(p) === 'OPTED_OUT').length;
  const noTickCount = people.filter((p) => p.whatsapp && consentOf(p) === 'NONE').length;
  const [text, setText] = useState<{ en: string; fr: string }>({ en: '', fr: '' });
  const [record, setRecord] = useState(true);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [contacted, setContacted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const needs = { en: withNumber.some((p) => p.language === 'en'), fr: withNumber.some((p) => p.language === 'fr') };
  const ready = (!needs.en || text.en.trim() !== '') && (!needs.fr || text.fr.trim() !== '');
  const current = withNumber[index];
  const finished = started && index >= withNumber.length;

  // One box filled and the other empty: offer to translate the filled one into the other (the sender can still edit it).
  const filled = { en: text.en.trim() !== '', fr: text.fr.trim() !== '' };
  const canTranslate = Boolean(translateUrl) && needs.en && needs.fr && filled.en !== filled.fr;
  async function translateOther() {
    if (!translateUrl) return;
    const from: 'en' | 'fr' = filled.en ? 'en' : 'fr';
    const to: 'en' | 'fr' = from === 'en' ? 'fr' : 'en';
    setTranslating(true);
    setTranslateError(null);
    try {
      const r = await api.post<{ detectedLanguage: 'en' | 'fr'; translatedBody: string }>(translateUrl, { text: text[from] });
      // If the sender wrote it in the other language than the box it was in, the boxes are swapped to match.
      setText(r.detectedLanguage === from ? { ...text, [to]: r.translatedBody } : { [from]: r.translatedBody, [to]: text[from] } as { en: string; fr: string });
    } catch (e) {
      setTranslateError(e instanceof ApiError && e.message ? e.message : t('needsMe.queue_translate_failed'));
    } finally {
      setTranslating(false);
    }
  }

  const message = (p: QueuePerson) => `${text[p.language].trim().split('{name}').join(firstName(p.name))}\n\n— ${t(signatureKey, { lng: p.language })}`;
  const useTemplate = () => setText(TEMPLATES[kind]);

  async function stopThem() {
    if (!current) return;
    try {
      await onStop?.(current);
    } catch {
      return;
    }
    // They drop out of the list; whoever is next slides into this place, so the index stays.
    setStopped((prev) => new Set(prev).add(current.personId));
  }

  function next(didContact: boolean) {
    if (didContact) {
      setContacted((n) => n + 1);
      if (record && current) Promise.resolve(recordContact(current)).catch(() => {});
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

      {!started && (
        <fieldset className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm" data-testid="queue-kind">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('needsMe.queue_kind_title')}</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="queue-kind" checked={kind === 'help'} onChange={() => setKind('help')} className="mt-1" data-testid="queue-kind-help" />
            <span>
              <strong>{t('needsMe.queue_kind_help')}</strong>
              <span className="block text-xs text-slate-600">{t('needsMe.queue_kind_help_note')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="queue-kind" checked={kind === 'nudge'} onChange={() => setKind('nudge')} className="mt-1" data-testid="queue-kind-nudge" />
            <span>
              <strong>{t('needsMe.queue_kind_nudge')}</strong>
              <span className="block text-xs text-slate-600">{t('needsMe.queue_kind_nudge_note')}</span>
            </span>
          </label>
          {kind === 'nudge' && noTickCount > 0 && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={includeNoTick} onChange={(e) => setIncludeNoTick(e.target.checked)} data-testid="queue-include-notick" />
              {t('needsMe.queue_include_notick', { count: noTickCount })}
            </label>
          )}
          {optedOutCount > 0 && <p className="text-xs text-amber-800" data-testid="queue-optedout-note">{t('needsMe.queue_optedout_note', { count: optedOutCount })}</p>}
        </fieldset>
      )}
      {people.filter((p) => !p.whatsapp).length > 0 && <p className="text-xs text-amber-800">{t('needsMe.queue_no_whatsapp', { count: people.filter((p) => !p.whatsapp).length })}</p>}
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
          {canTranslate && (
            <div>
              <button type="button" disabled={translating} onClick={() => void translateOther()} className="btn-secondary" data-testid="queue-translate">
                🌐 {translating ? t('needsMe.queue_translating') : t(filled.en ? 'needsMe.queue_translate_to_fr' : 'needsMe.queue_translate_to_en')}
              </button>
              {translateError && <p className="mt-1 text-xs text-red-700" role="alert">{translateError}</p>}
            </div>
          )}
          <button type="button" onClick={useTemplate} className="btn-secondary" data-testid="queue-template">
            ✍️ {t(kind === 'help' ? 'needsMe.queue_template_help' : 'needsMe.queue_template_nudge')}
          </button>
          <p className="text-xs text-slate-500">{t('needsMe.queue_name_hint')}</p>
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
          <p className="text-xs" data-testid="queue-consent">
            {consentOf(current) === 'AGREED' ? <span className="text-green-700">✓ {t('needsMe.consent_agreed')}</span> : <span className="text-slate-500">{t('needsMe.consent_none')}</span>}
          </p>
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message(current)}</p>
          <div className="flex flex-wrap gap-2">
            <a href={whatsappChatUrl(current.whatsapp!, message(current))} target="_blank" rel="noreferrer" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-green-700" data-testid="queue-open">
              {t('needsMe.queue_open')}
            </a>
            <button type="button" onClick={() => next(true)} className="btn-primary" data-testid="queue-next">{t('needsMe.queue_done_next')}</button>
            <button type="button" onClick={() => next(false)} className="btn-secondary" data-testid="queue-skip">{t('needsMe.queue_skip')}</button>
            {onStop && (
              <button type="button" onClick={() => void stopThem()} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" data-testid="queue-stop">
                {t('needsMe.queue_stop')}
              </button>
            )}
          </div>
        </div>
      )}

      {finished && <p className="rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800" role="status" data-testid="queue-finished">{t('needsMe.queue_finished', { done: contacted, skipped })}</p>}
    </section>
  );
}
