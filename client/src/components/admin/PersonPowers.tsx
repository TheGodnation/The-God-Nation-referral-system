import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface Powers {
  centralAdmin: boolean;
  hasDashboard: boolean;
  leaderAccount: { active: boolean; email: string } | null;
  assemblies: { communityId: string; name: string }[];
  areas: { areaId: string; level: string; title: string; place: string }[];
  nationalTeamTitle: string | null;
  notes: string[];
}

/**
 * "What this person can do": one place that shows every leadership power a person has (central admin,
 * assemblies they lead, the leader dashboard, the places they represent, the National Team), and says what is
 * missing when something was assigned but cannot be used yet.
 */
export function PersonPowers({ personId, refreshKey }: { personId: string; refreshKey?: unknown }) {
  const { t } = useTranslation();
  const [powers, setPowers] = useState<Powers | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    api
      .get<Powers>(`/api/admin/people/${personId}/powers`)
      .then((p) => live && setPowers({ ...p, assemblies: p.assemblies ?? [], areas: p.areas ?? [], notes: p.notes ?? [], nationalTeamTitle: p.nationalTeamTitle ?? null }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [personId, refreshKey]);

  if (failed) return null;
  if (!powers) return null;

  const none = !powers.centralAdmin && !powers.hasDashboard && powers.assemblies.length === 0 && powers.areas.length === 0 && !powers.nationalTeamTitle;
  const tick = (ok: boolean) => <span aria-hidden>{ok ? '✅' : '⬜'}</span>;
  const assemblyPowers = ['remove', 'results', 'prayer', 'events'] as const;

  return (
    <div className="card space-y-3" data-testid="person-powers">
      <h2 className="font-semibold text-brand-900">{t('admin.people.powers.title')}</h2>

      {none && <p className="text-sm text-slate-500">{t('admin.people.powers.none')}</p>}

      {powers.centralAdmin && (
        <p className="text-sm text-slate-800">
          {tick(true)} {t('admin.people.powers.central')}
        </p>
      )}

      {powers.nationalTeamTitle && (
        <p className="text-sm text-slate-800">
          {tick(true)} {t('admin.people.powers.team', { title: powers.nationalTeamTitle })}
        </p>
      )}

      {powers.assemblies.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-800">
            {tick(true)} {t('admin.people.powers.leads', { names: powers.assemblies.map((a) => a.name).join(', ') })}
          </p>
          <ul className="ml-7 list-disc space-y-0.5 text-sm text-slate-600">
            {assemblyPowers.map((k) => (
              <li key={k}>{t(`admin.people.powers.assembly_${k}`)}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-slate-800">
        {tick(powers.hasDashboard)} {t(powers.hasDashboard ? 'admin.people.powers.dashboard_yes' : 'admin.people.powers.dashboard_no')}
      </p>

      {powers.areas.length > 0 && (
        <div className="space-y-0.5">
          {powers.areas.map((a) => (
            <p key={a.areaId} className="text-sm text-slate-800">
              {tick(true)} {t('admin.people.powers.represents', { title: a.title, place: a.place })}
            </p>
          ))}
        </div>
      )}

      {powers.notes.length > 0 && (
        <ul className="space-y-1.5" data-testid="power-notes">
          {powers.notes.map((n) => (
            <li key={n} className={`rounded-lg px-3 py-2 text-sm ${n === 'SIGN_IN_AGAIN_ONCE' ? 'bg-sky-50 text-sky-900' : 'bg-amber-50 text-amber-900'}`}>
              {t(`admin.people.powers.note_${n.toLowerCase()}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
