import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublicSettings } from '../../lib/usePublicSettings';
import { finishRegistrationUrl, followUpPlaces, schoolWebsiteUrl, whatsappChatUrl, withLinks, type FollowUpId } from '../../lib/followUp';

const btn = 'rounded-lg px-3 py-1.5 text-sm font-semibold no-underline';

/**
 * What a leader can send a person on WhatsApp: a plain hello, our links so they join us, or a question about which
 * apps they use (with the links under it). Nothing is sent by the app: WhatsApp opens with the words already typed
 * and the leader presses send. No names are put in the message.
 */
export function FollowUpButtons({ personId, whatsapp, language, name, needsToFinish = false, personalLink }: { personId: string; whatsapp: string; language: 'en' | 'fr'; name?: string; needsToFinish?: boolean; personalLink?: (personId: string) => Promise<string> }) {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const places = followUpPlaces(settings, language, schoolWebsiteUrl(language));
  const [picking, setPicking] = useState(false);
  // "Continue on our website" is there to tick when it is needed; everything else starts ticked.
  const [unticked, setUnticked] = useState<Set<FollowUpId>>(new Set(['website']));

  // The words are in the person's language, not the leader's.
  const say = (key: string) => t(`followUp.${key}`, { lng: language });
  const labelled = (list: typeof places) => list.map((p) => ({ label: say(`place_${p.id}`), url: p.url }));
  const chosen = places.filter((p) => !unticked.has(p.id));

  const hello = whatsappChatUrl(whatsapp, say('hello'));
  // For someone who has not signed in or not finished registering: the right link, in their language, to finish.
  const first = (name ?? '').trim().split(/\s+/)[0];
  const finishText = t('followUp.finish_message', { lng: language, name: first || (language === 'fr' ? 'cher ami' : 'friend'), link: finishRegistrationUrl(language), interpolation: { escapeValue: false } });
  const finish = whatsappChatUrl(whatsapp, finishText);
  // The coordinator can also make a private, one-time link for this person (no emailed code needed): WhatsApp opens with it.
  const [making, setMaking] = useState(false);
  const [linkError, setLinkError] = useState(false);
  async function sendPersonal() {
    if (!personalLink) return;
    setMaking(true);
    setLinkError(false);
    // The window is opened at once (the tap), then pointed at WhatsApp when the link is ready, so phones do not block it.
    const win = window.open('', '_blank');
    try {
      const url = await personalLink(personId);
      const text = t('followUp.personal_message', { lng: language, name: first || (language === 'fr' ? 'cher ami' : 'friend'), link: url, interpolation: { escapeValue: false } });
      const target = whatsappChatUrl(whatsapp, text);
      if (win) win.location.href = target;
      else window.location.href = target;
    } catch {
      win?.close();
      setLinkError(true);
    } finally {
      setMaking(false);
    }
  }
  const links = whatsappChatUrl(whatsapp, withLinks(say('links_intro'), labelled(chosen)));
  const apps = whatsappChatUrl(whatsapp, withLinks(say('apps_question'), labelled(places.filter((p) => p.id !== 'website'))));

  function toggle(id: FollowUpId) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {needsToFinish && (
        <div>
          <a href={finish} target="_blank" rel="noreferrer" className={`${btn} inline-block bg-green-600 text-white hover:bg-green-700`} data-testid={`followup-finish-${personId}`}>
            {t('followUp.btn_finish')}
          </a>
          <p className="mt-1 text-xs text-slate-500">{t('followUp.finish_help')}</p>
          {personalLink && (
            <div className="mt-2">
              <button type="button" disabled={making} onClick={() => void sendPersonal()} className={`${btn} border border-green-600 text-green-800 hover:bg-green-50 disabled:opacity-60`} data-testid={`followup-personal-${personId}`}>
                {making ? t('followUp.personal_making') : t('followUp.btn_personal')}
              </button>
              <p className="mt-1 text-xs text-slate-500">{t('followUp.personal_help')}</p>
              {linkError && <p role="alert" className="mt-1 text-xs text-red-700">{t('followUp.personal_failed')}</p>}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={hello} target="_blank" rel="noreferrer" className={`${btn} bg-green-600 text-white hover:bg-green-700`} data-testid={`followup-hello-${personId}`}>
          {t('followUp.btn_hello')}
        </a>
        {places.length > 0 && (
          <>
            <button type="button" aria-expanded={picking} onClick={() => setPicking((v) => !v)} className={`${btn} border border-slate-300 text-brand-800 hover:bg-brand-50`} data-testid={`followup-links-${personId}`}>
              {t('followUp.btn_links')}
            </button>
            <a href={apps} target="_blank" rel="noreferrer" className={`${btn} border border-slate-300 text-brand-800 hover:bg-brand-50`} data-testid={`followup-apps-${personId}`}>
              {t('followUp.btn_apps')}
            </a>
          </>
        )}
      </div>
      {picking && places.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-3" data-testid={`followup-picker-${personId}`}>
          <p className="mb-2 text-sm text-slate-600">{t('followUp.pick_help')}</p>
          <ul className="space-y-1">
            {places.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" checked={!unticked.has(p.id)} onChange={() => toggle(p.id)} />
                  {t(`followUp.place_${p.id}`)}
                </label>
              </li>
            ))}
          </ul>
          {chosen.length > 0 ? (
            <a href={links} target="_blank" rel="noreferrer" className={`${btn} mt-3 inline-block bg-green-600 text-white hover:bg-green-700`} data-testid={`followup-send-${personId}`}>
              {t('followUp.send_links')}
            </a>
          ) : (
            <p className="mt-2 text-sm text-amber-700">{t('followUp.none_ticked')}</p>
          )}
        </div>
      )}
      {places.every((p) => p.id === 'website') && settings.loaded && <p className="text-xs text-slate-500">{t('followUp.no_links_yet')}</p>}
    </div>
  );
}
