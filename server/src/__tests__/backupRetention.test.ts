import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pickToDelete, takenAt } = require('../../scripts/backup/retention.cjs') as {
  pickToDelete: (keys: string[], now?: Date) => string[];
  takenAt: (key: string) => Date | null;
};

// Which old backups may be deleted: all from the last 30 days stay, then the
// newest of each month for a year, and the newest 3 always.
const NOW = new Date('2026-10-25T03:00:00Z');
const key = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `db/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/godnation-${stamp}.dump.enc`;
};
const daysAgo = (n: number, hour = 2) => new Date(NOW.getTime() - n * 86400000 + (hour - 3) * 3600000).toISOString();

describe('Backup retention', () => {
  it('reads the time from the name', () => {
    expect(takenAt('db/2026/10/godnation-20261025-023700.dump.enc')?.toISOString()).toBe('2026-10-25T02:37:00.000Z');
    expect(takenAt('db/readme.txt')).toBeNull();
  });

  it('keeps every backup of the last 30 days and deletes nothing when all are recent', () => {
    const keys = Array.from({ length: 30 }, (_, i) => key(daysAgo(i)));
    expect(pickToDelete(keys, NOW)).toEqual([]);
  });

  it('keeps only the newest of each older month, for a year', () => {
    const old = [key(daysAgo(40)), key(daysAgo(41)), key(daysAgo(42, 5))]; // all in September
    const recent = [key(daysAgo(1)), key(daysAgo(2)), key(daysAgo(3))];
    const doomed = pickToDelete([...old, ...recent], NOW);
    // September keeps its newest (40 days ago); the other two go.
    expect(doomed.sort()).toEqual([key(daysAgo(41)), key(daysAgo(42, 5))].sort());
  });

  it('lets backups older than about a year go, but never the newest three', () => {
    const veryOld = [key('2025-01-10T02:00:00Z'), key('2025-02-10T02:00:00Z')];
    const recent = [key(daysAgo(1)), key(daysAgo(2)), key(daysAgo(3))];
    expect(pickToDelete([...veryOld, ...recent], NOW).sort()).toEqual(veryOld.sort());

    // Even if everything is ancient (backups stopped), the newest 3 stay.
    const ancient = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01'].map((d) => key(`${d}T02:00:00Z`));
    expect(pickToDelete(ancient, NOW)).toEqual([key('2024-01-01T02:00:00Z')]);
  });

  it('never touches files that are not backups', () => {
    const keys = ['db/notes.txt', 'db/2026/10/other.bin', key(daysAgo(1))];
    expect(pickToDelete(keys, NOW)).toEqual([]);
  });
});
