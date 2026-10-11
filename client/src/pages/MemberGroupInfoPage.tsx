import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';

interface GroupMeta {
  name?: string | null;
  photoUrl?: string | null;
  aboutEn?: string | null;
  aboutFr?: string | null;
  muted?: boolean;
  mutedUntil?: string | null;
}

interface MemberRow {
  personId: string;
  name: string;
  photoUrl: string | null;
  isLeader: boolean;
  isYou: boolean;
  online: boolean;
}

const FIRST_SHOWN = 40;

function PersonLine({ p }: { p: MemberRow }) {
  const { t } = useTranslation();
  const inner = (
    <>
      <span className="relative">
        <Avatar name={p.name} photoUrl={p.photoUrl} size={40} />
        {p.online && (
          <span
            className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
            role="img"
            aria-label={t('groupInfo.online') ?? ''}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-900">{p.isYou ? t('groupChat.you') : p.name}</span>
        {p.online && <span className="block text-xs font-medium text-emerald-600">{t('groupInfo.online')}</span>}
      </span>
      {p.isLeader && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{t('groupInfo.leader')}</span>}
    </>
  );
  return (
    <li>
      {p.isYou ? (
        <div className="flex items-center gap-3 px-4 py-2">{inner}</div>
      ) : (
        <Link to={`/member/people/${p.personId}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
          {inner}
        </Link>
      )}
    </li>
  );
}

// The group info page (tap the group name in the chat): the group's
// picture and name, its purpose / vision, its leaders, and everyone in it
// with a green dot for those online now.
export function MemberGroupInfoPage() {
  const { t, i18n } = useTranslation();
  const { communityId = '' } = useParams();
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [muteError, setMuteError] = useState(false);

  async function setMute(choice: '8h' | '1w' | 'always' | null) {
    setMuteOpen(false);
    setMuteError(false);
    try {
      const r = choice
        ? await api.put<{ muted: boolean; mutedUntil: string | null }>(`/api/communities/${communityId}/conversation/mute`, { for: choice })
        : await api.delete<{ muted: boolean; mutedUntil: string | null }>(`/api/communities/${communityId}/conversation/mute`);
      setMeta((cur) => ({ ...(cur ?? {}), muted: r.muted, mutedUntil: r.mutedUntil }));
    } catch {
      setMuteError(true);
    }
  }

  useEffect(() => {
    api
      .get<GroupMeta>(`/api/communities/${communityId}/conversation`)
      .then(setMeta)
      .catch(() => setFailed(true));
    api
      .get<{ members: MemberRow[] }>(`/api/communities/${communityId}/conversation/members`)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }, [communityId]);

  const isFr = i18n.language.startsWith('fr');
  const about = ((isFr ? meta?.aboutFr || meta?.aboutEn : meta?.aboutEn || meta?.aboutFr) ?? '').trim();
  const leaders = (members ?? []).filter((m) => m.isLeader);
  const others = (members ?? []).filter((m) => !m.isLeader);
  const shown = showAll ? others : others.slice(0, FIRST_SHOWN);
  const online = (members ?? []).filter((m) => m.online).length;
  const name = meta?.name || t('groupChat.group');

  return (
    <div className="min-h-screen bg-slate-100 pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-brand-800 px-2 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white shadow">
        <Link to={`/member/chats/group/${communityId}`} aria-label={t('groupInfo.back') ?? ''} className="px-2 text-2xl leading-none">
          ←
        </Link>
        <h1 className="font-semibold">{t('groupChat.group_info')}</h1>
      </header>

      {failed ? (
        <p className="mx-auto mt-10 max-w-xs rounded-lg bg-white p-4 text-center text-sm text-slate-600">{t('groupChat.not_allowed')}</p>
      ) : (
        <div className="mx-auto max-w-2xl space-y-3 sm:px-4 sm:pt-4">
          <section className="bg-white px-4 py-6 text-center shadow-sm sm:rounded-xl">
            <div className="flex justify-center">
              <span className="rounded-full bg-white p-1 shadow">
                <Avatar name={name} photoUrl={meta?.photoUrl} size={112} />
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">{name}</h2>
            {members && (
              <p className="mt-1 text-sm text-slate-500">
                {t('groupChat.members_online', { members: members.length, online })}
              </p>
            )}
            <Link to={`/member/chats/group/${communityId}`} className="btn-primary mt-4 inline-block px-5 py-2 text-sm">
              💬 {t('groupInfo.open_chat')}
            </Link>
          </section>

          {about && (
            <section className="bg-white px-4 py-4 shadow-sm sm:rounded-xl">
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-brand-700">🎯 {t('groupInfo.about')}</h3>
              <p className={`whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800 ${about.length > 280 && !aboutOpen ? 'line-clamp-6' : ''}`}>{about}</p>
              {about.length > 280 && (
                <button type="button" onClick={() => setAboutOpen((v) => !v)} className="mt-1 text-sm font-semibold text-brand-700">
                  {aboutOpen ? t('updates.see_less') : t('updates.see_more')}
                </button>
              )}
            </section>
          )}

          <section className="bg-white px-4 py-3 shadow-sm sm:rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium text-slate-900">{meta?.muted ? '🔕' : '🔔'} {t('chatActions.mute_title')}</span>
                <span className="block text-xs text-slate-500">
                  {meta?.muted
                    ? meta.mutedUntil
                      ? t('chatActions.muted_until', {
                          when: new Date(meta.mutedUntil).toLocaleString(isFr ? 'fr-FR' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
                        })
                      : t('chatActions.muted_always')
                    : t('chatActions.not_muted')}
                </span>
              </span>
              {meta?.muted ? (
                <button type="button" onClick={() => void setMute(null)} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-brand-700">
                  {t('chatActions.unmute')}
                </button>
              ) : (
                <button type="button" onClick={() => setMuteOpen((v) => !v)} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-brand-700">
                  {t('chatActions.mute')}
                </button>
              )}
            </div>
            {muteOpen && !meta?.muted && (
              <div role="group" aria-label={t('chatActions.mute_title') ?? ''} className="mt-2 flex flex-wrap gap-2">
                {(['8h', '1w', 'always'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => void setMute(c)} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm">
                    {t(`chatActions.mute_${c}`)}
                  </button>
                ))}
              </div>
            )}
            {muteError && <p className="mt-1 text-xs text-red-700">{t('groupChat.action_failed')}</p>}
          </section>

          {members === null && <p className="py-6 text-center text-sm text-slate-400">{t('groupChat.loading')}</p>}

          {leaders.length > 0 && (
            <section className="bg-white py-2 shadow-sm sm:rounded-xl">
              <h3 className="px-4 pt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('groupInfo.leaders')}</h3>
              <ul>
                {leaders.map((p) => (
                  <PersonLine key={p.personId} p={p} />
                ))}
              </ul>
            </section>
          )}

          {others.length > 0 && (
            <section className="bg-white py-2 shadow-sm sm:rounded-xl">
              <h3 className="px-4 pt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {t('groupInfo.members', { count: others.length })}
              </h3>
              <ul>
                {shown.map((p) => (
                  <PersonLine key={p.personId} p={p} />
                ))}
              </ul>
              {others.length > shown.length && (
                <button type="button" onClick={() => setShowAll(true)} className="w-full px-4 py-3 text-left text-sm font-semibold text-brand-700">
                  {t('groupInfo.show_all', { count: others.length })}
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
