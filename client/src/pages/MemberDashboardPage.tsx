import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { CommunityConversation } from '../components/CommunityConversation';
import { MyFollowUps } from '../components/member/MyFollowUps';

interface AssessmentSummary {
  id: string;
  titleEn: string;
  titleFr: string | null;
  passMark: number;
  maxAttempts: number | null;
  status: string;
}

interface DevotionalSummary {
  id: string;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  community: { id: string; name: string } | null;
  assessments: AssessmentSummary[];
}

interface MembershipRow {
  communityId: string;
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
  joinedAt: string;
}

interface GeographicAssignmentInfo {
  geographyName: string;
  geographyType: string;
  assignedAt: string;
}

// Phase 3E — read-only, derived from existing Attempt data (never a new
// persisted "completion" record). See server/src/lib/trainingProgress.ts.
interface TrainingProgressItem {
  devotionalId: string;
  attempted: boolean;
  completed: boolean;
  bestPercentage: number | null;
}

interface TrainingProgressSummary {
  totalEligible: number;
  completedCount: number;
  items: TrainingProgressItem[];
}

// Phase 3F — self-service editing of the Member's own Person.name and
// Person.preferredLanguage only. Deliberately not WhatsApp/email/community/
// geography/leadership fields — see PATCH /api/member/me/profile.
function ProfileSection() {
  const { t, i18n } = useTranslation();
  const { member, refresh } = useMemberAuth();
  const [name, setName] = useState(member?.name ?? '');
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'fr'>(member?.preferredLanguage ?? 'en');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (member) {
      setName(member.name);
      setPreferredLanguage(member.preferredLanguage);
    }
  }, [member]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.patch('/api/member/me/profile', { name, preferredLanguage });
      await refresh();
      // The language switcher elsewhere in the app changes the UI language
      // this exact same way — reusing it here rather than inventing a
      // second mechanism. It also persists to localStorage on its own,
      // same as every other language change in the app.
      if (i18n.language.startsWith('fr') !== (preferredLanguage === 'fr')) {
        i18n.changeLanguage(preferredLanguage);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('memberDashboard.profile_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-3 font-semibold text-brand-900">{t('memberDashboard.profile_heading')}</h2>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="label">{t('memberDashboard.profile_name_label')}</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div>
          <label className="label">{t('memberDashboard.profile_language_label')}</label>
          <select
            className="input"
            value={preferredLanguage}
            onChange={(e) => setPreferredLanguage(e.target.value as 'en' | 'fr')}
          >
            <option value="en">{t('common.language_en')}</option>
            <option value="fr">{t('common.language_fr')}</option>
          </select>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm text-green-700">{t('memberDashboard.profile_saved')}</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? t('memberDashboard.profile_saving') : t('memberDashboard.profile_save')}
        </button>
      </form>
    </div>
  );
}

export function MemberDashboardPage() {
  const { t, i18n } = useTranslation();
  const { member, logout } = useMemberAuth();
  const [devotionals, setDevotionals] = useState<DevotionalSummary[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [assignment, setAssignment] = useState<GeographicAssignmentInfo | null>(null);
  const [progress, setProgress] = useState<TrainingProgressSummary | null>(null);
  const [progressError, setProgressError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const isFr = i18n.language.startsWith('fr');

  useEffect(() => {
    Promise.all([
      api.get<{ items: DevotionalSummary[] }>('/api/member/devotionals'),
      api.get<{ items: MembershipRow[] }>('/api/member/me/community-memberships'),
      api.get<{ assignment: GeographicAssignmentInfo | null }>('/api/member/me/geographic-assignment'),
    ])
      .then(([d, m, a]) => {
        setDevotionals(d.items);
        setMemberships(m.items);
        setAssignment(a.assignment);
      })
      .finally(() => setLoaded(true));

    // Fetched independently — a failure here must never block the rest of
    // the dashboard, which works exactly as it did before this phase.
    api
      .get<TrainingProgressSummary>('/api/member/me/training-progress')
      .then(setProgress)
      .catch(() => setProgressError(true));
  }, []);

  function progressFor(devotionalId: string): TrainingProgressItem | undefined {
    return progress?.items.find((i) => i.devotionalId === devotionalId);
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{t('memberDashboard.title')}</h1>
            {member && <p className="text-sm text-slate-500">{member.name}</p>}
          </div>
          <button onClick={() => logout()} className="btn-secondary">
            {t('memberDashboard.logout')}
          </button>
        </div>

        {!loaded ? (
          <p className="text-center text-slate-400">{t('memberDashboard.loading')}</p>
        ) : (
          <div className="space-y-6">
            <ProfileSection />

            <div className="card">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-brand-900">{t('memberDashboard.devotionals_heading')}</h2>
                {progress && progress.totalEligible > 0 && (
                  <span className="text-sm font-medium text-brand-700">
                    {t('memberDashboard.progress_summary', { completed: progress.completedCount, total: progress.totalEligible })}
                  </span>
                )}
              </div>
              {progressError && <p className="mb-3 text-xs text-slate-400">{t('memberDashboard.progress_unavailable')}</p>}
              {devotionals.length === 0 ? (
                <p className="text-sm text-slate-400">{t('memberDashboard.no_devotionals')}</p>
              ) : (
                <ul className="space-y-4">
                  {devotionals.map((d) => {
                    const title = isFr ? d.titleFr || d.titleEn : d.titleEn;
                    const itemProgress = progressFor(d.id);
                    return (
                      <li key={d.id} className="border-b border-slate-50 pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-brand-900">{title}</p>
                          {itemProgress && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                itemProgress.completed ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {itemProgress.completed ? t('memberDashboard.progress_completed') : t('memberDashboard.progress_not_yet')}
                            </span>
                          )}
                          {itemProgress?.bestPercentage !== null && itemProgress?.bestPercentage !== undefined && (
                            <span className="text-xs text-slate-400">
                              {t('memberDashboard.progress_best_percentage', { percentage: Math.round(itemProgress.bestPercentage) })}
                            </span>
                          )}
                        </div>
                        {d.assessments.length === 0 ? (
                          <p className="mt-1 text-sm text-slate-400">{t('memberDashboard.no_assessments')}</p>
                        ) : (
                          <ul className="mt-2 space-y-1">
                            {d.assessments.map((a) => {
                              const aTitle = isFr ? a.titleFr || a.titleEn : a.titleEn;
                              return (
                                <li key={a.id}>
                                  <Link to={`/member/assessments/${a.id}`} className="text-sm text-brand-700 hover:underline">
                                    {aTitle}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card">
              <h2 className="mb-3 font-semibold text-brand-900">{t('memberDashboard.community_heading')}</h2>
              {memberships.length === 0 ? (
                <p className="text-sm text-slate-400">{t('memberDashboard.no_memberships')}</p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-600">
                  {memberships.map((m, i) => (
                    <li key={i}>
                      {m.communityName} — {m.status === 'ACTIVE' ? t('memberDashboard.active') : t('memberDashboard.inactive')}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {memberships
              .filter((m) => m.status === 'ACTIVE')
              .map((m) => (
                <CommunityConversation key={m.communityId} communityId={m.communityId} communityName={m.communityName} />
              ))}

            <MyFollowUps />

            <div className="card">
              <h2 className="mb-3 font-semibold text-brand-900">{t('memberDashboard.geography_heading')}</h2>
              {assignment ? (
                <p className="text-sm text-slate-600">
                  {assignment.geographyName} ({assignment.geographyType})
                </p>
              ) : (
                <p className="text-sm text-slate-400">{t('memberDashboard.no_assignment')}</p>
              )}
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
