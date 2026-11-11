import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useMediaUploads } from '../../lib/useMediaUploads';
import { ChatComposer, type OutgoingMessage } from '../chat/ChatComposer';
import { UploadingBubble } from '../chat/UploadingBubble';
import { BroadcastLog, type BroadcastItem } from '../admin/BroadcastLogPanel';

const BASE = '/api/member/broadcast';

// "Message all my people": the leader writes once (text, photos, a voice message) and every person they look after
// gets it as an ordinary private message from them, with their first name in front.
export function BroadcastComposer() {
  const { t } = useTranslation();
  const [people, setPeople] = useState<{ id: string; name: string; language?: 'en' | 'fr' }[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<BroadcastItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPeople, setShowPeople] = useState(false);

  const loadHistory = useCallback(() => api.get<{ items: BroadcastItem[] }>(`${BASE}/mine`).then((r) => setHistory(r.items)).catch(() => {}), []);
  useEffect(() => {
    api
      .get<{ items: { id: string; name: string; language?: 'en' | 'fr' }[] }>(`${BASE}/people`)
      .then((r) => {
        setPeople(r.items);
        setSelected(new Set(r.items.map((p) => p.id)));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('broadcast.load_failed')));
    void loadHistory();
  }, [loadHistory, t]);

  const send = useCallback(
    async (out: OutgoingMessage): Promise<boolean> => {
      if (!people) return false;
      if (selected.size === 0) {
        setError(t('broadcast.nobody_selected'));
        return false;
      }
      setError(null);
      setNote(null);
      try {
        const res = await api.post<{ recipients: number; skipped: number }>(BASE, {
          ...(selected.size === people.length ? {} : { personIds: [...selected] }),
          body: out.body,
          attachments: out.attachments,
        });
        setNote(t('broadcast.sent', { count: res.recipients }) + (res.skipped > 0 ? ' ' + t('broadcast.skipped', { count: res.skipped }) : ''));
        void loadHistory();
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('broadcast.send_failed'));
        return false;
      }
    },
    [people, selected, loadHistory, t],
  );
  const media = useMediaUploads(`${BASE}/attachments/authorize`, send);

  const selectedFrench = (people ?? []).filter((p) => selected.has(p.id) && p.language === 'fr').length;
  const selectedEnglish = (people ?? []).filter((p) => selected.has(p.id) && p.language === 'en').length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4" data-testid="broadcast-composer">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('broadcast.title')}</h2>
        <p className="text-sm text-slate-600">{t('broadcast.help')}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}
      {!people && !error && <p className="text-sm text-slate-400">{t('broadcast.loading')}</p>}
      {people && people.length === 0 && <p className="card text-sm text-slate-600">{t('broadcast.nobody')}</p>}
      {people && people.length > 0 && (
        <>
          <section className="card space-y-2">
            <p className="font-semibold text-brand-900" data-testid="broadcast-count">{t('broadcast.will_go', { count: selected.size })}</p>
            {selected.size > 0 && (selectedFrench > 0 || selectedEnglish > 0) && (
              <p className="text-sm text-slate-600" data-testid="broadcast-languages">{t('needsMe.selected_languages', { en: selectedEnglish, fr: selectedFrench })}</p>
            )}
            {selectedFrench > 0 && selectedEnglish > 0 && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900" data-testid="broadcast-mixed-warning">{t('needsMe.mixed_warning', { en: selectedEnglish, fr: selectedFrench })}</p>
            )}
            {selectedFrench > 0 && selectedEnglish === 0 && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{t('needsMe.french_only_warning')}</p>}
            <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => setShowPeople((v) => !v)}>
              {showPeople ? t('broadcast.hide_people') : t('broadcast.choose_people')}
            </button>
            {showPeople && (
              <>
                <div className="flex gap-3 text-sm">
                  <button type="button" className="underline" onClick={() => setSelected(new Set(people.map((p) => p.id)))}>{t('broadcast.select_all')}</button>
                  <button type="button" className="underline" onClick={() => setSelected(new Set())}>{t('broadcast.select_none')}</button>
                </div>
                <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
                  {people.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                        {p.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-xs text-slate-500">{t('broadcast.greeting_note')}</p>
          </section>

          {media.jobs.length > 0 && (
            <div className="space-y-2">
              {media.jobs.map((job) => (
                <UploadingBubble key={job.id} job={job} onCancel={() => media.cancel(job.id)} onRetry={() => media.retry(job.id)} />
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <ChatComposer
              draftKey="broadcast"
              uploadPath={`${BASE}/attachments/authorize`}
              replyTo={null}
              onCancelReply={() => {}}
              onSend={send}
              onPickMedia={(files, caption) => media.start(files, undefined, caption)}
            />
          </div>
        </>
      )}

      {history.length > 0 && (
        <section className="card">
          <h3 className="mb-2 font-semibold text-brand-900">{t('broadcast.my_history')}</h3>
          <BroadcastLog items={history} showSender={false} />
        </section>
      )}
    </div>
  );
}
