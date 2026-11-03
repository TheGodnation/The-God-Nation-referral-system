import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A permanent guard: every API area that exists today must stay mounted at the same address.
// New areas may be added. (See docs/APPLICATION_MAP.md.)
const appSource = fs.readFileSync(path.join(__dirname, '../app.ts'), 'utf8');
const mounts = new Set([...appSource.matchAll(/app\.use\('(\/api[^']*)'/g)].map((m) => m[1]));
const existing: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/api-mounts.json'), 'utf8'));

describe('Existing API addresses contract', () => {
  it('every API area mounted today is still mounted at the same address', () => {
    expect(existing.filter((p) => !mounts.has(p))).toEqual([]);
  });
});
