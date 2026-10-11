import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { CAMEROON, CAMEROON_REGIONS, COUNTRIES, optionLabel } from '../lib/locations';

const OTHER = '__other__';

type Field = 'name' | 'country' | 'region' | 'division' | 'subdivision' | 'quarter' | 'city';

// Step 2 of joining: shown right after the member clicks their emailed
// link. They give their name and where they live; the server then places
// them in a group automatically and we send them into the community.
export function MemberCompleteProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { member, refresh } = useMemberAuth();

  // A brand-new sign-up has their email as a placeholder name — start empty.
  const initialName = member && member.name !== member.email ? member.name : '';
  const [name, setName] = useState(initialName);
  const [countryChoice, setCountryChoice] = useState<string>(CAMEROON);
  const [otherCountry, setOtherCountry] = useState('');
  const [region, setRegion] = useState('');
  const [division, setDivision] = useState('');
  const [subdivision, setSubdivision] = useState('');
  const [quarter, setQuarter] = useState('');
  const [city, setCity] = useState('');

  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const country = countryChoice === OTHER ? otherCountry.trim() : countryChoice;
  const inCameroon = country === CAMEROON;
  const language = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {};
    const required = t('memberCompleteProfile.required');
    if (!name.trim()) e.name = required;
    if (!country) e.country = required;
    if (inCameroon) {
      if (!region) e.region = required;
      if (!division.trim()) e.division = required;
      if (!subdivision.trim()) e.subdivision = required;
      if (!quarter.trim()) e.quarter = required;
    } else if (!city.trim()) {
      e.city = required;
    }
    return e;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSubmitting(true);
    try {
      await api.post('/api/member/auth/complete-profile', {
        name: name.trim(),
        preferredLanguage: language,
        country,
        ...(inCameroon
          ? { region, division: division.trim(), subdivision: subdivision.trim(), quarter: quarter.trim() }
          : { city: city.trim() }),
      });
      await refresh();
      navigate('/member/dashboard', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('memberCompleteProfile.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  function fieldError(field: Field) {
    return errors[field] ? (
      <p className="mt-1 text-xs font-medium text-red-700" role="alert">
        {errors[field]}
      </p>
    ) : null;
  }

  function textField(id: Field, label: string, value: string, set: (v: string) => void, placeholder?: string) {
    return (
      <div>
        <label className="label" htmlFor={`profile-${id}`}>
          {label}
        </label>
        <input
          id={`profile-${id}`}
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            set(e.target.value);
            if (errors[id]) setErrors({ ...errors, [id]: undefined });
          }}
        />
        {fieldError(id)}
      </div>
    );
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-2xl font-bold text-brand-900">{t('memberCompleteProfile.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('memberCompleteProfile.subtitle')}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          {textField('name', t('memberCompleteProfile.name_label'), name, setName)}

          <div>
            <label className="label" htmlFor="profile-country">
              {t('memberCompleteProfile.country_label')}
            </label>
            <select
              id="profile-country"
              className="input"
              value={countryChoice}
              onChange={(e) => setCountryChoice(e.target.value)}
            >
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {optionLabel(c, i18n.language)}
                </option>
              ))}
              <option value={OTHER}>{t('memberCompleteProfile.other_country')}</option>
            </select>
            {countryChoice === OTHER && (
              <input
                aria-label={t('memberCompleteProfile.other_country_label')}
                className="input mt-2"
                placeholder={t('memberCompleteProfile.other_country_label') ?? ''}
                value={otherCountry}
                onChange={(e) => setOtherCountry(e.target.value)}
              />
            )}
            {fieldError('country')}
          </div>

          {inCameroon ? (
            <>
              <div>
                <label className="label" htmlFor="profile-region">
                  {t('memberCompleteProfile.region_label')}
                </label>
                <select
                  id="profile-region"
                  className="input"
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    if (errors.region) setErrors({ ...errors, region: undefined });
                  }}
                >
                  <option value="">{t('memberCompleteProfile.choose_region')}</option>
                  {CAMEROON_REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {optionLabel(r, i18n.language)}
                    </option>
                  ))}
                </select>
                {fieldError('region')}
              </div>
              {textField('division', t('memberCompleteProfile.division_label'), division, setDivision, 'Mfoundi')}
              {textField('subdivision', t('memberCompleteProfile.subdivision_label'), subdivision, setSubdivision, 'Yaoundé III')}
              {textField('quarter', t('memberCompleteProfile.quarter_label'), quarter, setQuarter, 'Efoulan')}
            </>
          ) : (
            textField('city', t('memberCompleteProfile.city_label'), city, setCity)
          )}

          {formError && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {formError}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t('memberCompleteProfile.submitting') : t('memberCompleteProfile.submit')}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
