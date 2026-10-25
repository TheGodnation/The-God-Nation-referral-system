'use strict';
// Which old backups to delete. Keeps:
//  - every backup from the last 30 days,
//  - the newest backup of each month for the 12 months before that,
//  - and, whatever the rules say, always the 3 newest backups.
// Backup names carry their time: godnation-YYYYMMDD-HHMMSS.dump.enc
// Usage: node retention.cjs < list-of-keys   (prints the keys to delete)

const DAY = 24 * 60 * 60 * 1000;
const NAME = /godnation-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump\.enc$/;
const KEEP_DAILY_DAYS = 30;
const KEEP_MONTHS = 12;
const ALWAYS_KEEP_NEWEST = 3;

function takenAt(key) {
  const m = NAME.exec(key);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

function pickToDelete(keys, now = new Date()) {
  // Anything that is not a backup of ours is never touched.
  const backups = keys
    .map((key) => ({ key, at: takenAt(key) }))
    .filter((b) => b.at)
    .sort((a, b) => b.at - a.at);

  const keep = new Set(backups.slice(0, ALWAYS_KEEP_NEWEST).map((b) => b.key));
  const monthsSeen = new Set();
  for (const b of backups) {
    const age = now - b.at;
    if (age <= KEEP_DAILY_DAYS * DAY) {
      keep.add(b.key);
      continue;
    }
    const month = `${b.at.getUTCFullYear()}-${b.at.getUTCMonth()}`;
    const monthsAgo = (now.getUTCFullYear() - b.at.getUTCFullYear()) * 12 + (now.getUTCMonth() - b.at.getUTCMonth());
    // Newest first, so the first one seen for a month is that month's newest.
    if (!monthsSeen.has(month) && monthsAgo <= KEEP_MONTHS + 1) {
      monthsSeen.add(month);
      keep.add(b.key);
    }
  }
  return backups.filter((b) => !keep.has(b.key)).map((b) => b.key);
}

module.exports = { pickToDelete, takenAt };

if (require.main === module) {
  const input = require('fs').readFileSync(0, 'utf8').split(/\s+/).filter(Boolean);
  const doomed = pickToDelete(input);
  process.stdout.write(doomed.length ? doomed.join('\n') + '\n' : '');
}
