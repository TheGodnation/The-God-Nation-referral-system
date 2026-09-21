import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';

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
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
  joinedAt: string;
}

interface GeographicAssignmentInfo {
  geographyName: string;
  geographyType: string;
  assignedAt: string;
}

export function MemberDashboardPage() {
  const { t, i18n } = useTranslation();
  const { member, logout } = useMemberAuth();
  const [devotionals, setDevotionals] = useState<DevotionalSummary[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [assignment, setAssignment] = useState<GeographicAssignmentInfo | null>(null);
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
  }, []);

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
            <div className="card">
              <h2 className="mb-3 font-semibold text-brand-900">{t('memberDashboard.devotionals_heading')}</h2>
              {devotionals.length === 0 ? (
                <p className="text-sm text-slate-400">{t('memberDashboard.no_devotionals')}</p>
              ) : (
                <ul className="space-y-4">
                  {devotionals.map((d) => {
                    const title = isFr ? d.titleFr || d.titleEn : d.titleEn;
                    return (
                      <li key={d.id} className="border-b border-slate-50 pb-4 last:border-0 last:pb-0">
                        <p className="font-medium text-brand-900">{title}</p>
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
