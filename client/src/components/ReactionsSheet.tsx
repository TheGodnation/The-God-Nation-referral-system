import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';

// "Who reacted", like WhatsApp: tapping the reactions under a message,
// photo, voice note, video or post shows everyone who reacted and with
// what — "All" first, then one tab per emoji. Your own row says "You", and
// tapping it takes your reaction back.

export interface Reactor {
  personId: string | null;
  name: string;
  photoUrl: string | null;
  reaction: string;
  isMe: boolean;
}

export interface ReactorList {
  total: number;
  items: Reactor[];
}

export function ReactionsSheet({
  load,
  emojiOf = (r) => r,
  onLoaded,
  onRemoveMine,
  onClose,
}: {
  load: () => Promise<ReactorList>;
  /** Posts store a reaction type (LIKE, LOVE…); chats store the emoji itself. */
  emojiOf?: (reaction: string) => string;
  onLoaded?: (list: ReactorList & Record<string, unknown>) => void;
  onRemoveMine?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [list, setList] = useState<ReactorList | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<string>('ALL');

  useEffect(() => {
    let alive = true;
    load()
      .then((l) => {
        if (!alive) return;
        setList(l);
        onLoaded?.(l as ReactorList & Record<string, unknown>);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const kinds = list ? [...new Set(list.items.map((r) => r.reaction))] : [];
  const shown = list ? (tab === 'ALL' ? list.items : list.items.filter((r) => r.reaction === tab)) : [];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('reactions.title') ?? ''}
        className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-900">{t('reactions.title')}</h2>
          <button type="button" className="rounded-full p-1 text-xl leading-none text-slate-500" aria-label={t('reactions.close') ?? ''} onClick={onClose}>
            ✕
          </button>
        </div>
        {list && list.total > 0 && (
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'ALL'}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${tab === 'ALL' ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-600'}`}
              onClick={() => setTab('ALL')}
            >
              {t('reactions.all', { count: list.total })}
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${tab === k ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-600'}`}
                onClick={() => setTab(k)}
              >
                {emojiOf(k)} {list.items.filter((r) => r.reaction === k).length}
              </button>
            ))}
          </div>
        )}
        <div className="max-h-[55vh] overflow-y-auto">
          {!list && !failed && <p className="px-4 py-6 text-center text-sm text-slate-500">{t('reactions.loading')}</p>}
          {failed && <p className="px-4 py-6 text-center text-sm text-red-700">{t('reactions.failed')}</p>}
          {list && list.total === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">{t('reactions.none')}</p>}
          <ul>
            {shown.map((r, i) => {
              const row = (
                <>
                  <Avatar name={r.name} photoUrl={r.photoUrl} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{r.isMe ? t('reactions.you') : r.name}</span>
                    {r.isMe && onRemoveMine && <span className="block text-xs text-slate-500">{t('reactions.tap_to_remove')}</span>}
                  </span>
                  <span className="text-2xl" aria-hidden="true">
                    {emojiOf(r.reaction)}
                  </span>
                </>
              );
              return (
                <li key={`${r.personId ?? r.name}-${i}`}>
                  {r.isMe && onRemoveMine ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50"
                      onClick={() => {
                        onRemoveMine();
                        onClose();
                      }}
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
