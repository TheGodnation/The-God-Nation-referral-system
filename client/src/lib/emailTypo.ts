// Catches the common misspellings of big email providers (gmil.com,
// yahooo.fr…) so a visitor can fix them before we send a code to an address
// that does not exist. It only suggests — the visitor can keep what they typed.
const KNOWN_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'yahoo.fr',
  'hotmail.com',
  'hotmail.fr',
  'outlook.com',
  'outlook.fr',
  'live.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'ymail.com',
];

// Real addresses that sit close to a big provider's name — never "fix" these.
const REAL_LOOKALIKES = ['googlemail.com', 'aim.com', 'mail.com', 'gmx.com', 'gmx.fr', 'msn.com', 'live.fr', 'me.com', 'mac.com', 'yandex.com'];

// Misspellings too far from the real name for the distance check below.
const KNOWN_TYPOS: Record<string, string> = {
  'gmail.fr': 'gmail.com',
};

// Number of single-letter edits (add, remove, change, or swap two
// neighbours) needed to turn one word into the other.
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Returns the corrected full address, or null when it looks fine.
export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (KNOWN_DOMAINS.includes(domain) || REAL_LOOKALIKES.includes(domain)) return null;

  if (KNOWN_TYPOS[domain]) return `${local}@${KNOWN_TYPOS[domain]}`;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const known of KNOWN_DOMAINS) {
    const distance = editDistance(domain, known);
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  // Up to two slips (gmil, gmal, gnail, yahooo, hotmial…), and the first
  // letter must match, so an unrelated small domain is left alone.
  if (best && bestDistance <= 2 && domain[0] === best[0]) {
    return `${local}@${best}`;
  }
  return null;
}
