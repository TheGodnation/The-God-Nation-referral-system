// A representative's place as people say it, so a quarter is understood within its subdivision and division:
// "Bepanda, Douala V, Wouri" (not just "Bepanda"). `path` is the full path, nearest first
// ("Bepanda, Douala V, Wouri, Littoral, Cameroon").
const PARTS: Record<string, number> = { QUARTER: 3, SUBDIVISION: 2, DIVISION: 2, REGION: 1, NATIONAL: 1 };

export function shortPlace(level: string, path: string): string {
  const parts = path.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, PARTS[level] ?? 2).join(', ');
}
