import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../lib/prisma';

// The real backup scripts, end to end on the test database: dump → check →
// encrypt → store, then restore into a throw-away database and compare.
const SCRIPTS = path.resolve(__dirname, '../../scripts/backup');
const hasTools = [['pg_dump'], ['pg_restore'], ['psql'], ['openssl', 'version']].every(([tool, flag = '--version']) => spawnSync(tool, [flag]).status === 0);
const SOURCE = (process.env.DATABASE_URL ?? '').replace(/\?.*$/, '');
const SCRATCH_NAME = 'godnation_backup_scratch';
const ADMIN = SOURCE.replace(/\/[^/]+$/, '/postgres');
const SCRATCH = SOURCE.replace(/\/[^/]+$/, `/${SCRATCH_NAME}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));

function run(script: string, args: string[], env: Record<string, string>) {
  return spawnSync('bash', [path.join(SCRIPTS, script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

afterAll(() => {
  if (hasTools) spawnSync('psql', [ADMIN, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH_NAME}`]);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasTools)('Database backup scripts', () => {
  it('backs up, encrypts, restores into a fresh database, and the copy matches', async () => {
    await prisma.person.create({ data: { name: 'Backup Test Person Zeta', whatsappNumber: '+237670123456' } });
    await prisma.person.create({ data: { name: 'Backup Test Person Eta', whatsappNumber: '+237670123457' } });

    const keyFile = path.join(dir, 'key.txt');
    // The address is given the way the app has it (with Prisma's ?schema=public).
    const backup = run('backup-db.sh', [], {
      BACKUP_DATABASE_URL: `${SOURCE}?schema=public`,
      BACKUP_PASSPHRASE: 'a long test passphrase',
      BACKUP_LOCAL_DIR: dir,
      BACKUP_LAST_KEY_FILE: keyFile,
    });
    expect(backup.status, backup.stderr + backup.stdout).toBe(0);
    const stored = path.join(dir, fs.readFileSync(keyFile, 'utf8').trim());
    expect(fs.existsSync(stored)).toBe(true);

    // What is stored is encrypted: no dump header, no readable names.
    const bytes = fs.readFileSync(stored);
    expect(bytes.subarray(0, 5).toString()).not.toBe('PGDMP');
    expect(bytes.includes(Buffer.from('Backup Test Person Zeta'))).toBe(false);

    spawnSync('psql', [ADMIN, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH_NAME}`]);
    expect(spawnSync('psql', [ADMIN, '-qc', `CREATE DATABASE ${SCRATCH_NAME}`]).status).toBe(0);

    const verify = run('verify-restore.sh', [stored, `${SCRATCH}?schema=public`], {
      BACKUP_PASSPHRASE: 'a long test passphrase',
      LIVE_DATABASE_URL: `${SOURCE}?schema=public`,
    });
    expect(verify.status, verify.stderr + verify.stdout).toBe(0);
    expect(verify.stdout).toContain('Restore check passed.');

    const names = spawnSync('psql', [SCRATCH, '-Atc', `select name from "Person" order by name`], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(names).toEqual(['Backup Test Person Eta', 'Backup Test Person Zeta']);
  });

  it('refuses a wrong passphrase, and a missing one', () => {
    const files = fs.readdirSync(path.join(dir, 'db'), { recursive: true }).map(String).filter((f) => f.endsWith('.enc'));
    const stored = path.join(dir, 'db', files[0]);
    const wrong = run('restore-db.sh', [stored, SCRATCH, '--yes'], { BACKUP_PASSPHRASE: 'not the passphrase' });
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toMatch(/could not decrypt/i);
    const none = run('backup-db.sh', [], { BACKUP_DATABASE_URL: SOURCE, BACKUP_PASSPHRASE: '' });
    expect(none.status).not.toBe(0);
  });

  it('does not restore without the explicit YES', () => {
    const files = fs.readdirSync(path.join(dir, 'db'), { recursive: true }).map(String).filter((f) => f.endsWith('.enc'));
    const res = spawnSync('bash', [path.join(SCRIPTS, 'restore-db.sh'), path.join(dir, 'db', files[0]), SCRATCH], {
      env: { ...process.env, BACKUP_PASSPHRASE: 'a long test passphrase' },
      input: 'no\n',
      encoding: 'utf8',
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/REPLACE/);
  });
});
