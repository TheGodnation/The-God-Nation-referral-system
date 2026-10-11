import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { WallHeader } from '../components/wall/WallHeader';
import { PhotoGrid, WallTabs } from '../components/wall/PhotoGrid';
import { UpdatesFeed } from '../components/updates/UpdatesFeed';
import { MyResources } from '../components/MyResources';
import { MyFollowUps } from '../components/member/MyFollowUps';
import { api } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { ProfileImageError, uploadProfileImage } from '../lib/profileImages';

interface ExamWorld {
  devotionals: {
    id: string;
    titleEn: string;
    titleFr: string | null;
    exams: { id: string; weekNumber: number; firstScore: number | null; firstPassed: boolean | null }[];
  }[];
  training: {
    enrollment: 'NONE' | 'REQUESTED' | 'ACTIVE' | 'REVOKED';
    books: { id: string; trainingOrder: number; titleEn: string; titleFr: string | null; exam: { passed: boolean; bestPercentage: number | null } | null }[];
  };
}

interface MembershipRow {
  communityId: string;
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

type Tab = 'posts' | 'photos' | 'progress';

// "My progress" tab: this month's devotional exam scores, leadership
// training books passed, and the member's group(s).
function Progress({ groups }: { groups: MembershipRow[] }) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [data, setData] = useState<ExamWorld | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<ExamWorld>('/api/member/exam-world')
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const tr = (en: string, fr: string | null) => (isFr ? fr || en : en);
  const books = data?.training.books ?? [];
  const passed = books.filter((b) => b.exam?.passed).length;

  return (
    <div className="space-y-4">
      {failed && <p className="card text-sm text-red-700">{t('wall.progress_failed')}</p>}
      {!data && !failed && <p className="py-6 text-center text-sm text-slate-400">{t('wall.loading')}</p>}

      {data && (
        <>
          <section className="card space-y-3">
            <h2 className="font-semibold text-brand-900">📖 {t('wall.devotional_scores')}</h2>
            {data.devotionals.length === 0 && <p className="text-sm text-slate-500">{t('wall.no_devotional')}</p>}
            {data.devotionals.map((d) => (
              <div key={d.id}>
                <p className="text-sm font-medium text-slate-800">{tr(d.titleEn, d.titleFr)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.exams.length === 0 && <span className="text-sm text-slate-500">{t('wall.no_exams')}</span>}
                  {d.exams.map((e) => (
                    <span
                      key={e.id}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        e.firstScore === null ? 'bg-slate-100 text-slate-500' : e.firstPassed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {t('wall.week_score', { number: e.weekNumber, score: e.firstScore === null ? '—' : `${Math.round(e.firstScore)}%` })}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-brand-900">🎓 {t('wall.training')}</h2>
              {books.length > 0 && <span className="text-sm font-medium text-brand-700">{t('wall.books_passed', { passed, total: books.length })}</span>}
            </div>
            {books.length > 0 ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.round((passed / books.length) * 100)}%` }} />
                </div>
                <ul className="space-y-1 text-sm">
                  {books
                    .filter((b) => b.exam?.passed)
                    .map((b) => (
                      <li key={b.id} className="text-green-700">
                        ✓ {t('learn.book', { number: b.trainingOrder })}: {tr(b.titleEn, b.titleFr)} ({Math.round(b.exam!.bestPercentage ?? 0)}%)
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">{data.training.enrollment === 'REQUESTED' ? t('learn.training_requested') : t('wall.training_not_started')}</p>
            )}
            <Link to="/member/learn" className="inline-block text-sm font-medium text-brand-700 underline">
              {t('wall.go_learn')}
            </Link>
          </section>
        </>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold text-brand-900">👥 {t('wall.my_groups')}</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">{t('memberDashboard.no_memberships')}</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-700">
            {groups.map((g) => (
              <li key={g.communityId}>
                {g.communityName}
                {g.status !== 'ACTIVE' && <span className="text-slate-400"> — {t('memberDashboard.inactive')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <MyResources />
      <MyFollowUps />
    </div>
  );
}

// The member's own wall ("Me" tab): cover picture, round profile picture,
// name and a short line about them — then their posts, their photos and
// their progress. Personal details (phone, location…) are only shown on
// the Edit profile screen, never on the wall.
export function MemberMePage() {
  const { t } = useTranslation();
  const { member, refresh, logout } = useMemberAuth();
  const [tab, setTab] = useState<Tab>('posts');
  const [groups, setGroups] = useState<MembershipRow[]>([]);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'cover' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: MembershipRow[] }>('/api/member/me/community-memberships')
      .then((r) => setGroups(r.items))
      .catch(() => {});
    api
      .get<{ items: unknown[] }>('/api/member/friends')
      .then((r) => setFriendCount(r.items.length))
      .catch(() => {});
  }, []);

  async function pick(kind: 'cover' | 'photo', file: File) {
    setError(null);
    setBusy(kind);
    try {
      await uploadProfileImage(kind, file);
      await refresh();
    } catch (err) {
      const reason = err instanceof ProfileImageError ? err.reason : 'failed';
      setError(
        reason === 'storage'
          ? t('wall.storage_off')
          : reason === 'size'
            ? t('wall.too_big')
            : reason === 'type'
              ? t('wall.wrong_type')
              : t('wall.upload_failed'),
      );
    } finally {
      setBusy(null);
    }
  }

  if (!member) return null;

  const activeGroup = groups.find((g) => g.status === 'ACTIVE');
  const subtitle = [activeGroup?.communityName, friendCount !== null ? t('people.friend_count', { count: friendCount }) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl pb-6 sm:px-4 sm:pt-4">
        <WallHeader
          name={member.name}
          photoUrl={member.photoUrl}
          coverUrl={member.coverUrl}
          bio={member.bio}
          subtitle={subtitle}
          editable
          busy={busy}
          onPickCover={(f) => void pick('cover', f)}
          onPickPhoto={(f) => void pick('photo', f)}
        >
          {!member.bio && (
            <Link to="/member/me/edit" className="mb-2 block text-sm text-brand-700 underline">
              {t('wall.add_bio')}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/member/me/edit" className="btn-primary px-4 py-2 text-sm">
              ✏️ {t('wall.edit_profile')}
            </Link>
            <span className="ml-auto">
              <NotificationBell />
            </span>
            <button type="button" onClick={() => logout()} className="btn-secondary px-3 py-2 text-sm">
              {t('memberDashboard.logout')}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </WallHeader>

        <div className="mt-3">
          <WallTabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'posts', label: t('wall.tab_posts') },
              { id: 'photos', label: t('wall.tab_photos') },
              { id: 'progress', label: t('wall.tab_progress') },
            ]}
          />
        </div>

        <div className="mt-4 px-4 sm:px-0">
          {tab === 'posts' && member.personId && <UpdatesFeed authorPersonId={member.personId} linkAuthors />}
          {tab === 'photos' && member.personId && <PhotoGrid personId={member.personId} />}
          {tab === 'progress' && <Progress groups={groups} />}
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
