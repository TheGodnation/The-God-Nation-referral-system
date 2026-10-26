import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { PortraitCard } from '../PortraitCard';
import { RepresentRequestForm } from './RepresentRequestForm';

type GeographicLevel = 'NATIONAL' | 'REGION' | 'DIVISION' | 'SUBDIVISION' | 'QUARTER';

interface CountryRow {
  id: string;
  name: string;
  country: string;
}

interface Leader {
  personId: string;
  name: string;
  photoUrl: string | null;
  title?: string;
}

interface AreaEntry {
  id: string;
  name: string;
  level: GeographicLevel;
  title: string;
  path: string;
  leaders: Leader[];
}

interface TeamMember {
  personId: string;
  name: string;
  photoUrl: string | null;
  title: string;
}

const LEVELS: GeographicLevel[] = ['NATIONAL', 'REGION', 'DIVISION', 'SUBDIVISION', 'QUARTER'];

// "Our Leaders": who represents The God Nation where. At the top, the National
// Team (with the titles the central admin gave them); then the leaders of
// each place grouped by level, each as a face card with their position and
// the place they represent; then the places still waiting for someone. Above
// it all, the way for a member to ask to represent their own area. Leaders
// appear here by themselves the moment the admin places them.
export function GeographicDirectory() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [countries, setCountries] = useState<CountryRow[] | null>(null);
  const [country, setCountry] = useState<string>('');
  const [level, setLevel] = useState<'' | GeographicLevel>('');
  const [areas, setAreas] = useState<AreaEntry[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [fixedArea, setFixedArea] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    api
      .get<{ items: CountryRow[] }>('/api/member/geographic-areas/countries')
      .then((res) => {
        setCountries(res.items);
        if (res.items.length > 0) setCountry(res.items[0].country);
      })
      .catch(() => setCountries([]));
    api
      .get<{ items: TeamMember[] }>('/api/member/leadership-directory/national-team')
      .then((res) => setTeam(res.items))
      .catch(() => setTeam([]));
  }, []);

  useEffect(() => {
    if (!country) {
      setAreas(null);
      return;
    }
    setLoadError(false);
    api
      .get<{ items: AreaEntry[] }>(`/api/member/leadership-directory/areas?country=${encodeURIComponent(country)}`)
      .then((res) => setAreas(res.items))
      .catch(() => setLoadError(true));
  }, [country]);

  if (countries !== null && countries.length === 0 && team.length === 0) return null;

  const root = countries?.find((c) => c.country === country);
  const shown = (areas ?? []).filter((a) => !level || a.level === level);
  const represented = shown.filter((a) => a.leaders.length > 0);
  const vacant = shown.filter((a) => a.leaders.length === 0 && a.level !== 'NATIONAL');
  const levelName = (lv: GeographicLevel) => t(`admin.geographicAreas.level_${lv.toLowerCase()}`);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('leadershipDirectory.intro')}</p>

      {root && (
        <RepresentRequestForm
          country={country}
          rootId={root.id}
          fixedArea={fixedArea}
          onClearFixedArea={() => setFixedArea(null)}
        />
      )}

      {team.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-semibold text-brand-900">{t('leadershipDirectory.team_title')}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {team.map((m) => (
              <PortraitCard
                key={m.personId}
                name={m.name}
                photoUrl={m.photoUrl}
                caption={m.title}
                className="w-full"
                onClick={() => navigate(`/member/people/${m.personId}`)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold text-brand-900">{t('leadershipDirectory.geo_title')}</h2>
          <p className="text-sm text-slate-500">{t('leadershipDirectory.geo_help')}</p>
        </div>

        {countries && countries.length > 1 && (
          <select className="input w-auto" value={country} aria-label={t('leadershipDirectory.country') ?? ''} onChange={(e) => setCountry(e.target.value)}>
            {countries.map((c) => (
              <option key={c.id} value={c.country}>
                {c.country}
              </option>
            ))}
          </select>
        )}

        <div className="flex flex-wrap gap-2" role="group" aria-label={t('leadershipDirectory.geo_all_levels') ?? ''}>
          {(['', ...LEVELS] as ('' | GeographicLevel)[]).map((lv) => (
            <button
              key={lv || 'all'}
              type="button"
              aria-pressed={level === lv}
              onClick={() => setLevel(lv)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${level === lv ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {lv === '' ? t('leadershipDirectory.geo_all_levels') : levelName(lv)}
            </button>
          ))}
        </div>

        {loadError && <p className="text-sm text-red-700">{t('leadershipDirectory.geo_load_failed')}</p>}
        {areas === null && !loadError && <p className="text-sm text-slate-400">{t('memberDashboard.loading')}</p>}

        {areas !== null &&
          (represented.length > 0 ? (
            <div className="space-y-5">
              {LEVELS.map((lv) => {
                const group = represented.filter((a) => a.level === lv);
                if (group.length === 0) return null;
                return (
                  <div key={lv}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{levelName(lv)}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {group.flatMap((a) =>
                        a.leaders.map((leader) => (
                          <div key={`${a.id}-${leader.personId}`} className="space-y-1">
                            <PortraitCard
                              name={leader.name}
                              photoUrl={leader.photoUrl}
                              caption={`${leader.title ?? a.title} · ${a.name}`}
                              className="w-full"
                              onClick={() => navigate(`/member/people/${leader.personId}`)}
                            />
                            <p className="line-clamp-2 text-[11px] leading-tight text-slate-500">{a.path}</p>
                          </div>
                        )),
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('leadershipDirectory.geo_none_represented')}</p>
          ))}

        {vacant.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('leadershipDirectory.geo_vacant_title')}</h3>
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-sm text-slate-600">
              {vacant.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    {a.title} — {a.path}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-brand-700 underline"
                    onClick={() => {
                      setFixedArea({ id: a.id, label: `${a.title} — ${a.path}` });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    {t('leadershipDirectory.represent_this')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
