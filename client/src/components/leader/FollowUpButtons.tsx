import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublicSettings } from '../../lib/usePublicSettings';
import { followUpPlaces, whatsappChatUrl, withLinks, type FollowUpId } from '../../lib/followUp';

const btn = 'rounded-lg px-3 py-1.5 text-sm font-semibold no-underline';

/**
 * What a leader can send a person on WhatsApp: a plain hello, our links so they join us, or a question about which
 * apps they use (with the links under it). Nothing is sent by the app: WhatsApp opens with the words already typed
 * and the leader presses send. No names are put in the message.
 */
export function FollowUpButtons({ personId, whatsapp, language }: { personId: string; whatsapp: string; language: 'en' | 'fr' }) {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const places = followUpPlaces(settings, language);
  const [picking, setPicking] = useState(false);
  const [unticked, setUnticked] = useState<Set<FollowUpId>>(new Set());

  // The words are in the person's language, not the leader's.
  const say = (key: string) => t(`followUp.${key}`, { lng: language });
  const labelled = (list: typeof places) => list.map((p) => ({ label: say(`place_${p.id}`), url: p.url }));
  const chosen = places.filter((p) => !unticked.has(p.id));

  const hello = whatsappChatUrl(whatsapp, say('hello'));
  const links = whatsappChatUrl(whatsapp, withLinks(say('links_intro'), labelled(chosen)));
  const apps = whatsappChatUrl(whatsapp, withLinks(say('apps_question'), labelled(places)));

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
      {places.length === 0 && settings.loaded && <p className="text-xs text-slate-500">{t('followUp.no_links_yet')}</p>}
    </div>
  );
}
