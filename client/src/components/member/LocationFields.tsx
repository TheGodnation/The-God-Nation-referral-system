import { useTranslation } from 'react-i18next';
import { CAMEROON, CAMEROON_REGIONS, COUNTRIES, optionLabel } from '../../lib/locations';

// Where a member lives, always asked in the same order: country, region,
// division, subdivision, quarter — when joining, on the "tell us about you"
// step, and when editing the profile. For Cameroon the region is picked from
// the ten regions; anywhere else every level is typed in (a place that is not
// on a list is simply written the same way).

export const OTHER_COUNTRY = '__other__';

export interface LocationValue {
  countryChoice: string;
  otherCountry: string;
  region: string;
  division: string;
  subdivision: string;
  quarter: string;
}

export type LocationField = 'country' | 'region' | 'division' | 'subdivision' | 'quarter';
export type LocationErrors = Partial<Record<LocationField, string>>;

export const EMPTY_LOCATION: LocationValue = { countryChoice: CAMEROON, otherCountry: '', region: '', division: '', subdivision: '', quarter: '' };

export function locationCountry(v: LocationValue): string {
  return v.countryChoice === OTHER_COUNTRY ? v.otherCountry.trim() : v.countryChoice;
}

/** Starts the form from a saved country and places (a country not on the list becomes "Other"). */
export function locationFrom(saved: { country?: string | null; region?: string | null; division?: string | null; subdivision?: string | null; quarter?: string | null }): LocationValue {
  const country = saved.country ?? '';
  const known = COUNTRIES.some((c) => c.value === country);
  return {
    countryChoice: !country ? CAMEROON : known ? country : OTHER_COUNTRY,
    otherCountry: country && !known ? country : '',
    region: saved.region ?? '',
    division: saved.division ?? '',
    subdivision: saved.subdivision ?? '',
    quarter: saved.quarter ?? '',
  };
}

/** What is missing: for Cameroon all four places, anywhere else just the country and region. */
export function validateLocation(v: LocationValue, message: string): LocationErrors {
  const errors: LocationErrors = {};
  const country = locationCountry(v);
  if (!country) errors.country = message;
  if (country === CAMEROON) {
    if (!v.region) errors.region = message;
    if (!v.division.trim()) errors.division = message;
    if (!v.subdivision.trim()) errors.subdivision = message;
    if (!v.quarter.trim()) errors.quarter = message;
  } else if (country && !v.region.trim()) {
    errors.region = message;
  }
  return errors;
}

/** The places to send, without the empty ones. */
export function locationPayload(v: LocationValue) {
  const out: { country: string; region?: string; division?: string; subdivision?: string; quarter?: string } = { country: locationCountry(v) };
  if (v.region.trim()) out.region = v.region.trim();
  if (v.division.trim()) out.division = v.division.trim();
  if (v.subdivision.trim()) out.subdivision = v.subdivision.trim();
  if (v.quarter.trim()) out.quarter = v.quarter.trim();
  return out;
}

export function LocationFields({
  value,
  onChange,
  idPrefix,
  errors = {},
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  idPrefix: string;
  errors?: LocationErrors;
}) {
  const { t, i18n } = useTranslation();
  const country = locationCountry(value);
  const inCameroon = country === CAMEROON;
  const set = (patch: Partial<LocationValue>) => onChange({ ...value, ...patch });
  const err = (field: LocationField) =>
    errors[field] ? (
      <p className="mt-1 text-xs font-medium text-red-700" role="alert">
        {errors[field]}
      </p>
    ) : null;
  const text = (field: 'region' | 'division' | 'subdivision' | 'quarter', label: string, placeholder?: string) => (
    <div>
      <label className="label" htmlFor={`${idPrefix}-${field}`}>
        {label}
      </label>
      <input id={`${idPrefix}-${field}`} className="input" placeholder={placeholder} maxLength={100} value={value[field]} onChange={(e) => set({ [field]: e.target.value })} />
      {err(field)}
    </div>
  );

  return (
    <>
      <div>
        <label className="label" htmlFor={`${idPrefix}-country`}>
          {t('memberCompleteProfile.country_label')}
        </label>
        <select id={`${idPrefix}-country`} className="input" value={value.countryChoice} onChange={(e) => set({ countryChoice: e.target.value })}>
          {COUNTRIES.map((c) => (
            <option key={c.value} value={c.value}>
              {optionLabel(c, i18n.language)}
            </option>
          ))}
          <option value={OTHER_COUNTRY}>{t('memberCompleteProfile.other_country')}</option>
        </select>
        {value.countryChoice === OTHER_COUNTRY && (
          <input
            aria-label={t('memberCompleteProfile.other_country_label') ?? ''}
            className="input mt-2"
            placeholder={t('memberCompleteProfile.other_country_label') ?? ''}
            maxLength={100}
            value={value.otherCountry}
            onChange={(e) => set({ otherCountry: e.target.value })}
          />
        )}
        {err('country')}
      </div>

      {inCameroon ? (
        <div>
          <label className="label" htmlFor={`${idPrefix}-region`}>
            {t('memberCompleteProfile.region_label')}
          </label>
          <select id={`${idPrefix}-region`} className="input" value={value.region} onChange={(e) => set({ region: e.target.value })}>
            <option value="">{t('memberCompleteProfile.choose_region')}</option>
            {CAMEROON_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {optionLabel(r, i18n.language)}
              </option>
            ))}
          </select>
          {err('region')}
        </div>
      ) : (
        text('region', t('memberCompleteProfile.region_label'))
      )}
      {text('division', t('memberCompleteProfile.division_label'), inCameroon ? 'Mfoundi' : undefined)}
      {text('subdivision', t('memberCompleteProfile.subdivision_label'), inCameroon ? 'Yaoundé III' : undefined)}
      {text('quarter', t('memberCompleteProfile.quarter_label'), inCameroon ? 'Efoulan' : undefined)}
    </>
  );
}
