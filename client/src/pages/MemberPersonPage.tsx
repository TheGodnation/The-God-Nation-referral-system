import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { Avatar } from '../components/Avatar';
import { FriendButton, type FriendStatus } from '../components/people/PersonCard';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';

interface Profile {
  personId: string;
  name: string;
  photoUrl: string | null;
  area: string | null;
  isLeader: boolean;
  sameGroup: boolean;
  friendStatus: FriendStatus;
  requestId: string | null;
  friendCount: number;
  canMessage: boolean;
}

// Another member's profile: photo, name, area, friendship button,
// Message (when allowed), Block and Report, and their posts.
export function MemberPersonPage() {
  const { t } = useTranslation();
  const { personId = '' } = useParams();
  const { member } = useMemberAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [messageResult, setMessageResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [reportResult, setReportResult] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    setNotFound(false);
    api
      .get<Profile>(`/api/member/people/${personId}`)
      .then(setProfile)
      .catch(() => setNotFound(true));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [personId]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setMessageResult(null);
    try {
      await api.post('/api/member/messages/start', { personId, body: message.trim() });
      setMessage('');
      setComposing(false);
      setMessageResult({ ok: true, text: t('people.message_sent') });
    } catch (err) {
      setMessageResult({ ok: false, text: err instanceof ApiError && err.code === 'NOT_ALLOWED' ? t('people.message_not_allowed') : t('people.action_failed') });
    }
  }

  async function sendReport(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setReportResult({ ok: false, text: t('people.report_need_reason') });
      return;
    }
    try {
      await api.post('/api/member/reports', { personId, targetType: 'PERSON', reason: reason.trim() });
      setReason('');
      setReporting(false);
      setReportResult({ ok: true, text: t('people.report_sent') });
    } catch {
      setReportResult({ ok: false, text: t('people.action_failed') });
    }
  }

  async function toggleBlock() {
    if (!profile) return;
    if (profile.friendStatus === 'BLOCKED') {
      await api.delete(`/api/member/blocks/${personId}`).catch(() => {});
    } else {
      if (!window.confirm(t('people.confirm_block', { name: profile.name }) ?? '')) return;
      await api.post('/api/member/blocks', { personId }).catch(() => {});
    }
    load();
  }

  const isMe = member?.personId === personId;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <MemberNav />
        {notFound && (
          <div className="card space-y-2">
            <p className="text-slate-600">{t('people.not_found')}</p>
            <Link to="/member/people" className="text-brand-700 underline">
              {t('people.back')}
            </Link>
          </div>
        )}
        {!profile && !notFound && <p className="text-center text-slate-400">{t('people.loading')}</p>}
        {profile && (
          <div className="space-y-6">
            <div className="card space-y-4 text-center">
              <div className="flex justify-center">
                <Avatar name={profile.name} photoUrl={profile.photoUrl} size={96} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-brand-900">{profile.name}</h1>
                <p className="text-sm text-slate-500">
                  {[profile.isLeader ? t('people.leader_badge') : null, profile.area, t('people.friend_count', { count: profile.friendCount })]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>

              {!isMe && (
                <div className="flex flex-wrap justify-center gap-2">
                  {profile.friendStatus !== 'BLOCKED' && (
                    <FriendButton person={profile} onChange={() => load()} />
                  )}
                  {profile.canMessage && (
                    <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setComposing((v) => !v)}>
                      💬 {t('people.message')}
                    </button>
                  )}
                </div>
              )}

              {!isMe && !profile.canMessage && profile.friendStatus !== 'BLOCKED' && (
                <p className="text-xs text-slate-500">{t('people.message_hint')}</p>
              )}

              {composing && (
                <form onSubmit={sendMessage} className="space-y-2 text-left">
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={2000}
                    aria-label={t('people.message_label') ?? ''}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button type="submit" className="btn-primary" disabled={!message.trim()}>
                    {t('people.send')}
                  </button>
                </form>
              )}
              {messageResult && (
                <p role="status" className={`text-sm ${messageResult.ok ? 'text-green-700' : 'text-red-700'}`}>
                  {messageResult.text}
                </p>
              )}

              {!isMe && (
                <div className="flex justify-center gap-4 border-t border-slate-100 pt-3 text-sm">
                  <button type="button" className="text-slate-600 underline" onClick={toggleBlock}>
                    {profile.friendStatus === 'BLOCKED' ? t('people.unblock') : t('people.block')}
                  </button>
                  <button type="button" className="text-red-700 underline" onClick={() => setReporting((v) => !v)}>
                    {t('people.report')}
                  </button>
                </div>
              )}

              {reporting && (
                <form onSubmit={sendReport} className="space-y-2 text-left">
                  <p className="text-sm text-slate-600">{t('people.report_help')}</p>
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={1000}
                    aria-label={t('people.report_label') ?? ''}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button type="submit" className="btn-primary">
                    {t('people.report_send')}
                  </button>
                </form>
              )}
              {reportResult && (
                <p role="status" className={`text-sm ${reportResult.ok ? 'text-green-700' : 'text-red-700'}`}>
                  {reportResult.text}
                </p>
              )}
            </div>

            {profile.friendStatus !== 'BLOCKED' && (
              <div>
                <h2 className="mb-3 font-semibold text-brand-900">{t('people.posts_title')}</h2>
                <UpdatesFeed authorPersonId={profile.personId} showComposer={false} />
              </div>
            )}
          </div>
        )}
      </section>
    </PageShell>
  );
}
