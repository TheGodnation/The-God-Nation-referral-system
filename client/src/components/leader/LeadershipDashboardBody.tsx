import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Announcements } from '../Announcements';
import { HeadquartersPosts } from '../HeadquartersPosts';
import { PrayerRequests } from '../PrayerRequests';
import { LeaderUpdates } from '../updates/LeaderUpdates';
import { ReportsList } from '../ReportsList';
import { ExamResults } from './ExamResults';
import { ExamResults as QuizAndExamMarks } from '../admin/ExamResults';
import { PrivateMessages } from '../PrivateMessages';
import { MyResources } from '../MyResources';
import { StartPrivateMessage } from './StartPrivateMessage';
import { MyFollowUp } from './MyFollowUp';
import { MyPeople } from './MyPeople';
import { Escalations } from './Escalations';
import { ClinicBookCard } from './ClinicBookCard';
import { TrainingProgress } from './TrainingProgress';
import { MyMembers } from './MyMembers';
import { MyLeadershipPeers } from './MyLeadershipPeers';
import { LeaderLeadershipCollaboration } from './LeaderLeadershipCollaboration';
import { LeaderCommunityConversations } from './LeaderCommunityConversations';
import { LeaderInstructions, type MyInstruction } from './LeaderInstructions';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { usePublicSettings } from '../../lib/usePublicSettings';

interface DashboardStats {
  conversionRate: number;
}

interface ReferralItem {
  name: string;
  whatsapp: string;
  language: string;
  registeredAt: string;
  status: string;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{value}</p>
    </div>
  );
}

// Section 24-26: additive "Invite People" panel. Every share/send action
// uses the Leader's own referral link only — never a client-suppliable
// Leader ID or code, and the server derives the link from the session.
function InvitePeople({
  links,
  messageTemplate,
}: {
  links: { en: string; fr: string } | null;
  messageTemplate?: string;
}) {
  const { t, i18n } = useTranslation();
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  if (!links) return null;
  const primaryLink = i18n.language.startsWith('fr') ? links.fr : links.en;

  const whatsappMessage = messageTemplate
    ? messageTemplate.replace(/\{\{link\}\}/g, primaryLink)
    : t('leader.invite_message', { link: primaryLink });
  const telegramMessage = messageTemplate
    ? messageTemplate
        .split('\n')
        .filter((line) => !line.includes('{{link}}'))
        .join('\n')
        .trim()
    : t('leader.invite_message_telegram');

  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;
  const messengerShareUrl = `https://www.facebook.com/dialog/send?link=${encodeURIComponent(primaryLink)}&app_id=0&redirect_uri=${encodeURIComponent(primaryLink)}`;
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(primaryLink)}&text=${encodeURIComponent(telegramMessage)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(primaryLink);
      setEmailStatus(t('leader.invite_link_copied'));
      setTimeout(() => setEmailStatus(null), 1500);
    } catch {
      // no-op
    }
  }

  async function webShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'The God Nation', text: whatsappMessage, url: primaryLink });
      } catch {
        // user cancelled — no-op
      }
    }
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('leader.invite_title')}</h2>
      <div className="flex flex-wrap gap-3">
        <a href={whatsappShareUrl} target="_blank" rel="noreferrer" className="btn-primary bg-green-600 hover:bg-green-700">
          {t('leader.share_whatsapp')}
        </a>
        <a href={messengerShareUrl} target="_blank" rel="noreferrer" className="btn-secondary">
          {t('leader.share_messenger')}
        </a>
        <a
          href={telegramShareUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary bg-sky-500 text-white hover:bg-sky-600"
        >
          {t('leader.share_telegram')}
        </a>
        <button type="button" onClick={copyLink} className="btn-secondary">
          {t('leader.copy_referral_link')}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" onClick={webShare} className="btn-secondary">
            {t('leader.share_generic')}
          </button>
        )}
      </div>
      {emailStatus && <p className="mt-2 text-sm text-slate-600">{emailStatus}</p>}
    </div>
  );
}

// The full body of a Leader's tools: referral link + stats, Your
// Referrals, and every Leader-facing content/collaboration panel. Shared
// by the standalone LeaderDashboardPage (for Leaders who have not yet
// bridged to a Member profile — see server/src/routes/leader.ts's
// /me/create-member-profile) and MyLeadershipDashboardPage (the same tools
// living inside the Member app, Section 8). Fetches its own data from
// /api/leader/* exactly as before — unaffected by which page renders it,
// since a bridged Leader's Member session now silently carries a paired
// Leader session too (Section 25's auto-pairing).
interface HealthItem {
  id: string;
  name: string;
  parentId: string | null;
  own: { color: 'GREEN' | 'YELLOW' | 'RED' | 'GREY'; weeklyRate: number | null };
}
const HEALTH_DOT = { GREEN: 'bg-green-500', YELLOW: 'bg-amber-400', RED: 'bg-red-500', GREY: 'bg-slate-300' } as const;

// How the assemblies I lead, and the ones below them, are doing.
function AssemblyHealthForLeader() {
  const { t } = useTranslation();
  const [items, setItems] = useState<HealthItem[]>([]);
  useEffect(() => {
    api.get<{ items: HealthItem[] }>('/api/leader/assembly-health').then((r) => setItems(r.items)).catch(() => {});
  }, []);
  if (items.length === 0) return null;
  return (
    <section className="card space-y-2" data-testid="assembly-health-leader">
      <h2 className="font-semibold text-brand-900">{t('oversight.health_below')}</h2>
      <ul className="divide-y divide-slate-100">
        {items.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className={`mr-2 inline-block h-3 w-3 rounded-full align-middle ${HEALTH_DOT[h.own.color]}`} />
              {h.name}
            </span>
            <span className="text-xs text-slate-500">
              {t(`oversight.health_${h.own.color.toLowerCase()}`)}
              {h.own.weeklyRate !== null && ` · ${t('oversight.health_rate', { percent: Math.round(h.own.weeklyRate * 100) })}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LeaderEscalations() {
  const { t } = useTranslation();
  return (
    <Escalations
      hideWhenEmpty
      messagesBase="/api/leader/escalations"
      lists={[
        { key: 'inbox', title: t('escalations.for_me'), url: '/api/leader/escalations/inbox', empty: t('escalations.none') },
        { key: 'mine', title: t('escalations.i_asked'), url: '/api/leader/escalations/mine', empty: t('escalations.none') },
      ]}
    />
  );
}

type SectionKey = 'instructions' | 'people' | 'messages' | 'assembly' | 'news' | 'prayer' | 'results' | 'invite' | 'together' | 'reports' | 'resources';

interface MyPeopleSummary {
  total: number;
  needingAttention: number;
}

/**
 * The Leader's home: who they are and what they lead, what needs them today, and one tile for each job a
 * leader does (look after people, message them, run the assembly, share news, pray, see results, invite,
 * work with other leaders, handle reports, find resources). A tile opens that job on its own with a plain
 * explanation and a way back. The same panels as before, just given a place and a name.
 */
export function LeadershipDashboardBody() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { content } = usePublicSettings();
  const [params, setParams] = useSearchParams();
  const lang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const messageTemplate = content[`leaderInviteMessage${lang}`] || undefined;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [links, setLinks] = useState<{ en: string; fr: string } | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [items, setItems] = useState<ReferralItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const [assemblies, setAssemblies] = useState<string[] | null>(null);
  const [people, setPeople] = useState<MyPeopleSummary | null>(null);
  const [pendingInstructions, setPendingInstructions] = useState(0);
  const loadPendingInstructions = () =>
    api
      .get<{ items: MyInstruction[] }>('/api/member/instructions/')
      .then((r) => setPendingInstructions(r.items.filter((i) => i.status !== 'DONE').length))
      .catch(() => {});

  useEffect(() => {
    api
      .get<{ referralCode: string | null; stats: DashboardStats }>('/api/leader/dashboard')
      .then((res) => {
        setStats(res.stats);
        setReferralCode(res.referralCode);
      })
      .catch(() => {});
    api
      .get<{ referralCode: string | null; links: { en: string; fr: string } | null }>('/api/leader/links')
      .then((res) => setLinks(res.links))
      .catch(() => {});
    api
      .get<{ items: { community: { name: string } | null }[] }>('/api/leader/role-assignments')
      .then((res) => setAssemblies(res.items.flatMap((r) => (r.community ? [r.community.name] : []))))
      .catch(() => setAssemblies([]));
    void loadPendingInstructions();
    api
      .get<MyPeopleSummary>('/api/leader/my-people')
      .then((res) => setPeople({ total: res.total, needingAttention: res.needingAttention }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get<{ items: ReferralItem[]; pagination: { totalPages: number } }>(`/api/leader/referrals?page=${page}&pageSize=20`)
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => {});
  }, [page]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard API unavailable — no-op; the link is still selectable/visible.
    }
  }

  const sections: { key: SectionKey; icon: string; render: () => ReactNode }[] = [
    { key: 'instructions', icon: '📌', render: () => <LeaderInstructions onChanged={() => void loadPendingInstructions()} /> },
    {
      key: 'people',
      icon: '👥',
      render: () => (
        <>
          <MyPeople />
          <MyFollowUp />
          <MyMembers />
        </>
      ),
    },
    {
      key: 'messages',
      icon: '💬',
      render: () => (
        <>
          <StartPrivateMessage />
          <PrivateMessages />
        </>
      ),
    },
    {
      key: 'assembly',
      icon: '🏛️',
      render: () => (
        <>
          <LeaderCommunityConversations />
          <AssemblyHealthForLeader />
          <Link to="/member/events" className="card mt-6 block text-sm font-semibold text-brand-700 no-underline">
            📅 {t('leaderHome.open_events')} ›
          </Link>
        </>
      ),
    },
    {
      key: 'news',
      icon: '📣',
      render: () => (
        <>
          <Announcements />
          <HeadquartersPosts />
          <LeaderUpdates />
        </>
      ),
    },
    { key: 'prayer', icon: '🙏', render: () => <PrayerRequests /> },
    {
      key: 'results',
      icon: '📝',
      render: () => (
        <>
          <ExamResults />
          <section className="space-y-2" data-testid="leader-quiz-marks">
            <QuizAndExamMarks base="/api/leader/results" hideWhenEmpty />
          </section>
          <TrainingProgress />
          <ClinicBookCard mode="leader" statusUrl="/api/leader/clinic" sendUrl="/api/leader/clinic/send" />
        </>
      ),
    },
    {
      key: 'invite',
      icon: '📩',
      render: () => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label={t('leader.stat_referral_code')} value={referralCode ?? '—'} />
            <StatCard label={t('leader.stat_conversion')} value={stats ? `${stats.conversionRate}%` : '—'} />
          </div>

          <div className="card mt-6">
            <h2 className="mb-3 font-semibold text-brand-900">{t('leader.links_title')}</h2>
            {links ? (
              <div className="space-y-3">
                {(['en', 'fr'] as const).map((l) => (
                  <div key={l} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="w-10 text-sm font-medium uppercase text-slate-500">{l}</span>
                    <input readOnly value={links[l]} className="input flex-1 bg-slate-50 text-sm" />
                    <button className="btn-secondary sm:w-32" onClick={() => copy(links[l], l)}>
                      {copied === l ? t('leader.copied') : t('leader.copy')}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t('leader.no_referral_code')}</p>
            )}
          </div>

          <InvitePeople links={links} messageTemplate={messageTemplate} />

          <div className="card mt-6 overflow-x-auto">
            <h2 className="mb-3 font-semibold text-brand-900">{t('leader.referrals_title')}</h2>
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="py-2 pr-4">{t('leader.table_name')}</th>
                  <th className="py-2 pr-4">{t('leader.table_whatsapp')}</th>
                  <th className="py-2 pr-4">{t('leader.table_language')}</th>
                  <th className="py-2 pr-4">{t('leader.table_registered')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, idx) => (
                  <tr key={idx} className="border-b border-slate-50">
                    <td className="py-2 pr-4">{r.name}</td>
                    <td className="py-2 pr-4">{r.whatsapp}</td>
                    <td className="py-2 pr-4 uppercase">{r.language}</td>
                    <td className="py-2 pr-4">{new Date(r.registeredAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      {t('leader.no_referrals')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t('leader.prev')}
                </button>
                <span>{t('leader.page_of', { page, total: totalPages })}</span>
                <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {t('leader.next')}
                </button>
              </div>
            )}
          </div>
        </>
      ),
    },
    {
      key: 'together',
      icon: '🤝',
      render: () => (
        <>
          <LeaderEscalations />
          <MyLeadershipPeers />
          <LeaderLeadershipCollaboration />
        </>
      ),
    },
    { key: 'reports', icon: '🚩', render: () => <ReportsList basePath="/api/leader/member-reports" /> },
    { key: 'resources', icon: '📚', render: () => <MyResources /> },
  ];

  const openKey = params.get('section');
  const open = sections.find((s) => s.key === openKey) ?? null;

  if (open) {
    return (
      <div data-testid={`leader-section-${open.key}`}>
        <button type="button" className="mb-3 text-sm font-semibold text-brand-700" onClick={() => setParams({})}>
          ← {t('leaderHome.back')}
        </button>
        <h2 className="text-xl font-bold text-brand-900">
          <span aria-hidden>{open.icon}</span> {t(`leaderHome.${open.key}_title`)}
        </h2>
        <p className="mb-2 mt-1 text-sm text-slate-600">{t(`leaderHome.${open.key}_help`)}</p>
        {open.render()}
        <p className="mt-6 text-center text-xs text-slate-400">{t('leaderHome.empty_note')}</p>
      </div>
    );
  }

  const firstName = (user?.name ?? '').trim().split(/\s+/)[0];
  const needing = people?.needingAttention ?? 0;

  return (
    <div className="space-y-4" data-testid="leader-home">
      <section className="card space-y-2">
        <p className="text-lg font-bold text-brand-900">{firstName ? t('leaderHome.welcome', { name: firstName }) : t('leaderHome.welcome_plain')}</p>
        {assemblies && assemblies.length > 0 ? (
          <p className="text-sm text-slate-700" data-testid="leader-assemblies">
            {t('leaderHome.you_lead')} <strong>{assemblies.join(', ')}</strong>
          </p>
        ) : (
          assemblies && <p className="text-sm text-slate-500">{t('leaderHome.no_assembly')}</p>
        )}
        <p className="text-xs text-slate-500">{t('leaderHome.how_it_works')}</p>
      </section>

      {people && (
        <button
          type="button"
          onClick={() => setParams({ section: 'people' })}
          className={`block w-full rounded-xl border p-4 text-left ${needing > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-200 bg-green-50'}`}
          data-testid="leader-attention"
        >
          <span className="block font-semibold text-slate-900">
            {needing > 0 ? t('leaderHome.attention_some', { count: needing }) : people.total > 0 ? t('leaderHome.attention_none') : t('leaderHome.attention_nobody')}
          </span>
          <span className="mt-0.5 block text-sm text-slate-600">{needing > 0 ? t('leaderHome.attention_tap') : t('leaderHome.people_total', { count: people.total })}</span>
        </button>
      )}

      {pendingInstructions > 0 && (
        <button
          type="button"
          onClick={() => setParams({ section: 'instructions' })}
          className="block w-full rounded-xl border border-brand-300 bg-brand-50 p-4 text-left"
          data-testid="leader-instructions-banner"
        >
          <span className="block font-semibold text-brand-900">📌 {t('leaderHome.instructions_waiting', { count: pendingInstructions })}</span>
          <span className="mt-0.5 block text-sm text-slate-600">{t('leaderHome.instructions_tap')}</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3" data-testid="leader-tiles">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setParams({ section: s.key })}
            className="flex flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand-300"
          >
            <span aria-hidden className="text-2xl">{s.icon}</span>
            <span className="text-sm font-bold text-brand-900">{t(`leaderHome.${s.key}_title`)}</span>
            <span className="text-xs leading-snug text-slate-600">{t(`leaderHome.${s.key}_tile`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
