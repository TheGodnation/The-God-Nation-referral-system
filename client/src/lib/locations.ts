// Location choices for the member sign-up details form.
//
// The stored value is always the English name (so the admin map groups
// everyone the same way whatever language they signed up in); the label
// shown follows the member's language.

export const CAMEROON = 'Cameroon';

export interface LocationOption {
  value: string;
  en: string;
  fr: string;
}

// The 10 regions of Cameroon.
export const CAMEROON_REGIONS: LocationOption[] = [
  { value: 'Adamawa', en: 'Adamawa', fr: 'Adamaoua' },
  { value: 'Centre', en: 'Centre', fr: 'Centre' },
  { value: 'East', en: 'East', fr: 'Est' },
  { value: 'Far North', en: 'Far North', fr: 'Extrême-Nord' },
  { value: 'Littoral', en: 'Littoral', fr: 'Littoral' },
  { value: 'North', en: 'North', fr: 'Nord' },
  { value: 'North-West', en: 'North-West', fr: 'Nord-Ouest' },
  { value: 'South', en: 'South', fr: 'Sud' },
  { value: 'South-West', en: 'South-West', fr: 'Sud-Ouest' },
  { value: 'West', en: 'West', fr: 'Ouest' },
];

// Countries offered in the picker (Cameroon first, then neighbours and the
// countries members most often come from). "Other" lets anyone type theirs.
export const COUNTRIES: LocationOption[] = [
  { value: 'Cameroon', en: 'Cameroon', fr: 'Cameroun' },
  { value: 'Nigeria', en: 'Nigeria', fr: 'Nigeria' },
  { value: 'Chad', en: 'Chad', fr: 'Tchad' },
  { value: 'Central African Republic', en: 'Central African Republic', fr: 'République centrafricaine' },
  { value: 'Gabon', en: 'Gabon', fr: 'Gabon' },
  { value: 'Equatorial Guinea', en: 'Equatorial Guinea', fr: 'Guinée équatoriale' },
  { value: 'Republic of the Congo', en: 'Republic of the Congo', fr: 'République du Congo' },
  { value: 'DR Congo', en: 'DR Congo', fr: 'RD Congo' },
  { value: "Côte d'Ivoire", en: "Côte d'Ivoire", fr: "Côte d'Ivoire" },
  { value: 'Ghana', en: 'Ghana', fr: 'Ghana' },
  { value: 'Senegal', en: 'Senegal', fr: 'Sénégal' },
  { value: 'Benin', en: 'Benin', fr: 'Bénin' },
  { value: 'Togo', en: 'Togo', fr: 'Togo' },
  { value: 'Kenya', en: 'Kenya', fr: 'Kenya' },
  { value: 'South Africa', en: 'South Africa', fr: 'Afrique du Sud' },
  { value: 'France', en: 'France', fr: 'France' },
  { value: 'Belgium', en: 'Belgium', fr: 'Belgique' },
  { value: 'Germany', en: 'Germany', fr: 'Allemagne' },
  { value: 'United Kingdom', en: 'United Kingdom', fr: 'Royaume-Uni' },
  { value: 'United States', en: 'United States', fr: 'États-Unis' },
  { value: 'Canada', en: 'Canada', fr: 'Canada' },
];

export function optionLabel(option: LocationOption, language: string): string {
  return language.startsWith('fr') ? option.fr : option.en;
}
