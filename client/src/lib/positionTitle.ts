// The server names a representative's position in English ("Quarter Representative",
// "First Assistant Subdivision Representative"...; see server/src/lib/geographicAreas.ts and
// areaSeats.ts). A French reader sees the French name of those standard titles. A title the central
// admin wrote himself is shown exactly as he wrote it.
const FR: Record<string, string> = {
  'National Representative of The God Nation': 'Représentant national de The God Nation',
  'Regional Leader': 'Responsable régional',
  'Divisional Leader': 'Responsable départemental',
  'Subdivisional Leader': 'Responsable d’arrondissement',
  'Quarter Representative': 'Représentant de quartier',
  'Subdivision Representative': 'Représentant d’arrondissement',
  'First Assistant Subdivision Representative': 'Premier représentant adjoint d’arrondissement',
  'Second Assistant Subdivision Representative': 'Deuxième représentant adjoint d’arrondissement',
  'Third Assistant Subdivision Representative': 'Troisième représentant adjoint d’arrondissement',
  'Fourth Assistant Subdivision Representative': 'Quatrième représentant adjoint d’arrondissement',
};

export function localPositionTitle(title: string | null | undefined, language: string): string {
  if (!title) return '';
  return language.startsWith('fr') ? FR[title] ?? title : title;
}
