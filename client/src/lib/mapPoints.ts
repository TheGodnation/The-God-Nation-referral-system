// Where to draw each bubble on the admin member map: the capital city of
// each Cameroon region, and a central point (usually the capital) for each
// country in the sign-up country list. Keys are the stored English names
// (see lib/locations.ts). A country typed in by hand under "Other" has no
// point here; it still appears in the list beside the map.

export const CAMEROON_CENTER: [number, number] = [5.7, 12.4];

export const REGION_POINTS: Record<string, [number, number]> = {
  Adamawa: [7.327, 13.5847], // Ngaoundéré
  Centre: [3.848, 11.5021], // Yaoundé
  East: [4.5774, 13.6846], // Bertoua
  'Far North': [10.5956, 14.3247], // Maroua
  Littoral: [4.0511, 9.7679], // Douala
  North: [9.3014, 13.3977], // Garoua
  'North-West': [5.9631, 10.1591], // Bamenda
  South: [2.9, 11.15], // Ebolowa
  'South-West': [4.1527, 9.241], // Buea
  West: [5.4778, 10.4176], // Bafoussam
};

export const COUNTRY_POINTS: Record<string, [number, number]> = {
  Cameroon: [3.848, 11.5021],
  Nigeria: [9.0765, 7.3986],
  Chad: [12.1348, 15.0557],
  'Central African Republic': [4.3947, 18.5582],
  Gabon: [0.4162, 9.4673],
  'Equatorial Guinea': [3.7504, 8.7371],
  'Republic of the Congo': [-4.2634, 15.2429],
  'DR Congo': [-4.4419, 15.2663],
  "Côte d'Ivoire": [5.36, -4.0083],
  Ghana: [5.6037, -0.187],
  Senegal: [14.7167, -17.4677],
  Benin: [6.3703, 2.3912],
  Togo: [6.1256, 1.2254],
  Kenya: [-1.2921, 36.8219],
  'South Africa': [-26.2041, 28.0473],
  France: [48.8566, 2.3522],
  Belgium: [50.8503, 4.3517],
  Germany: [52.52, 13.405],
  'United Kingdom': [51.5074, -0.1278],
  'United States': [39.8283, -98.5795],
  Canada: [45.4215, -75.6972],
};

/** Case-insensitive lookup, so "cameroon" still finds "Cameroon". */
export function pointFor(table: Record<string, [number, number]>, name: string): [number, number] | null {
  const key = Object.keys(table).find((k) => k.toLowerCase() === name.trim().toLowerCase());
  return key ? table[key] : null;
}
